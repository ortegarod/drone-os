// The operator's main screen: fleet list, map, selected drone (camera, control,
// flying, patrol) and the shared command log. Everything goes through the fleet API.
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, command, FleetDrone, useFleet } from '../api/fleet';
import FleetMap from './FleetMap';
import { JOBS as BUILTIN_JOBS, AppCtx, Job, JobType, MapHandlers, Shape } from './apps/registry';
import { loadPluginUi, PluginInfo } from './apps/external';
import PluginAdmin from './PluginAdmin';
import OperatorAdmin from './OperatorAdmin';
import GeofenceAdmin, { FenceInfo } from './GeofenceAdmin';
import { useRole } from '../components/LoginGate';
import { homeOf, LatLon, toLocal, distance, insidePolygon } from './geo';
import { PatrolStatus, patrolAt, patrolTotal, reasonText, statusOf } from './status';
import './CommandCenter.css';

interface LogEntry { time: string; operator: string; drone?: string; command: string; args?: Record<string, any>; ok: boolean; message?: string }
type ClickMode = 'none' | 'goto' | 'orbit' | 'pick';
type MenuTab = 'controls' | 'status' | 'job' | 'reports' | 'dev';
const MENU: Array<{ id: MenuTab; icon: string; name: string }> = [
  { id: 'controls', icon: 'Fly', name: 'Flight controls' },
  { id: 'status', icon: 'Status', name: 'Drone status' },
  { id: 'job', icon: 'Job', name: 'Job' },
  { id: 'reports', icon: 'Reports', name: 'Reports' },
  { id: 'dev', icon: 'Dev', name: 'Dev: operators, plugins, raw state' },
];
interface Config { geofence: { radius_m: number; max_altitude_m: number }; max_speed_mps: number }


const COMPASS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
const compass = (deg: number) => COMPASS[Math.round((((deg % 360) + 360) % 360) / 45) % 8];

/** Ground speed, direction of travel and climb rate from PX4's velocity. */
function motion(d?: FleetDrone) {
  const vn = d?.velocity.north || 0, ve = d?.velocity.east || 0, vd = d?.velocity.down || 0;
  const speed = Math.hypot(vn, ve);
  const course = speed > 0.5 ? (Math.atan2(ve, vn) * 180) / Math.PI : null;
  return { speed, course, climb: -vd };
}

/** One line: what the drone is doing right now, in words. */
function doing(d: FleetDrone | undefined, p: PatrolStatus | null | undefined, job?: Job | null): string {
  if (!d || !d.online) return 'No telemetry';
  if (d.failsafe) return `PX4 failsafe: ${(d.failsafe_reasons || []).map(reasonText).join(', ') || 'active'}`;
  const home = homeOf(d);
  const here = d.gps.lat != null && d.gps.lon != null ? { lat: d.gps.lat, lon: d.gps.lon } : null;
  const fromHome = home && here ? distance(home, here) : null;
  const toTarget = here && d.target ? distance(here, { lat: d.target.lat, lon: d.target.lon }) : null;
  const togo = toTarget != null && toTarget > 3 ? ` · ${toTarget.toFixed(0)} m to go` : '';
  if (job && !d.armed) return `${job.plugin} job: starting`;
  if (!d.armed) return d.health.can_arm ? 'On the ground, ready to fly'
    : `On the ground, not ready: ${(d.failsafe_reasons || []).map(reasonText).join(', ') || 'PX4 checks failing'}`;
  const mode = (d.mode || '').toUpperCase();
  const pre = job ? `${job.plugin[0].toUpperCase()}${job.plugin.slice(1)} job · ` : '';
  if (mode.includes('RTL') || mode.includes('RETURN')) return `${pre}Returning home${fromHome != null && fromHome > 3 ? ` · ${fromHome.toFixed(0)} m out` : ', descending'}`;
  if (mode.includes('LAND')) return `Landing · ${fmt(d.position.altitude, 0)} m up`;
  if (mode.includes('TAKEOFF')) return `${pre}Climbing · ${fmt(d.position.altitude, 0)} m`;
  if (mode.includes('ORBIT')) return 'Circling a point';
  if (p?.running) return `Patrol: flying to point ${patrolAt(p)} of ${patrolTotal(p)}${togo}`;
  if (p?.paused) return `Patrol paused at point ${patrolAt(p)} of ${patrolTotal(p)}, holding`;
  if (mode.includes('LOITER') || mode.includes('HOLD')) return toTarget != null && toTarget > 3 ? `Flying to a point${togo}` : 'Holding position';
  return `Flying${togo}`;
}

const fmt = (v: number | null | undefined, d = 0) => (v == null || isNaN(v) ? '–' : v.toFixed(d));
const clock = (iso: string) => { const t = new Date(iso); return isNaN(t.getTime()) ? iso : t.toLocaleTimeString([], { hour12: false }); };

function describe(e: LogEntry): string {
  const a = e.args || {};
  switch (e.command) {
    case 'takeoff': return `take off to ${a.altitude ?? '?'} m`;
    case 'goto': return `go to N${fmt(a.north)} E${fmt(a.east)}${a.altitude != null ? ` at ${a.altitude} m` : ''}`;
    case 'patrol': return `patrol ${(a.route || []).length} points × ${a.loops ?? 1} at ${a.altitude ?? '?'} m`;
    case 'return_home': return 'return home';
    case 'hold': return 'hold position';
    case 'orbit': return `orbit N${fmt(a.north)} E${fmt(a.east)}, r ${a.radius ?? '?'} m at ${a.speed ?? '?'} m/s`;
    case 'route': return (a.points || []).length ? `set route: ${(a.points || []).length} points` : 'clear route';
    case 'job_start': return `start ${a.plugin || ''} job`;
    case 'job_end': return `${a.plugin || ''} job ended`;
    case 'take_control': return 'take control';
    case 'release_control': return 'release control';
    default: return e.command.replace('_', ' ');
  }
}

const Camera: React.FC<{ drone: string; det?: FleetDrone['detections'] }> = ({ drone, det }) => {
  const [attempt, setAttempt] = useState(0);
  const [live, setLive] = useState(false);
  useEffect(() => { setLive(false); setAttempt(0); }, [drone]);
  if (!drone) return <div className="cc-camera empty">No drone selected</div>;
  // older fleet APIs don't send "confirmed": show everything then
  const shown = (det?.objects || []).filter(o => o.confirmed !== false);
  const src = `/camera/stream?topic=${encodeURIComponent('/' + drone + '/camera')}&type=mjpeg&width=640&height=480&quality=50&r=${attempt}`;
  return (
    <div className="cc-camera">
      <img key={src} src={src} alt={`${drone} camera`} onLoad={() => setLive(true)}
           onError={() => { setLive(false); setTimeout(() => setAttempt(a => a + 1), 2000); }} />
      <span className={`cc-camera-tag ${live ? 'live' : ''}`}>{live ? '● LIVE' : 'connecting…'} {drone}</span>
      {live && det && (
        <div className="cc-det" title="Object detector on the drone (only objects seen in several frames in a row)">
          {shown.map((o, i) => (
            <div key={i} className={`cc-det-box det-${o.label.replace(/[^a-z]/gi, '')}`}
                 style={{ left: `${o.box[0] * 100}%`, top: `${o.box[1] * 100}%`, width: `${(o.box[2] - o.box[0]) * 100}%`, height: `${(o.box[3] - o.box[1]) * 100}%` }}>
              <span>{o.label} {Math.round(o.score * 100)}%</span>
            </div>
          ))}
          <span className="cc-det-tag">{shown.length ? shown.length + ' detected' : 'detector on'}{det.fps ? ` · ${det.fps.toFixed(0)} fps` : ''}</span>
        </div>
      )}
    </div>
  );
};

const CommandCenter: React.FC<{ operator: string }> = ({ operator }) => {
  const role = useRole();
  const fleet = useFleet();
  const [selected, setSelected] = useState('');
  const [altitude, setAltitude] = useState(50);
  const [orbitRadius, setOrbitRadius] = useState(25);
  const [orbitSpeed, setOrbitSpeed] = useState(4);
  const [orbit, setOrbit] = useState<{ center: LatLon; radius: number } | null>(null);
  const [config, setConfig] = useState<Config | null>(null);
  useEffect(() => { api<Config>('GET', '/config').then(setConfig).catch(() => {}); }, []);
  const [fenceInfo, setFenceInfo] = useState<FenceInfo | null>(null);
  const [mapOrigin, setMapOrigin] = useState<LatLon | null>(null);   // the geofence editor's site, while editing
  const loadFence = useCallback(() => { api<FenceInfo>('GET', '/geofence').then(setFenceInfo).catch(() => {}); }, []);
  useEffect(() => { loadFence(); const t = setInterval(loadFence, 15000); return () => clearInterval(t); }, [loadFence]);
  const [mode, setMode] = useState<ClickMode>('none');
  const pickRef = useRef<{ prompt: string; done: (p: { north: number; east: number } | null) => void } | null>(null);
  const [pickPrompt, setPickPrompt] = useState('');
  // Shapes (and their handlers) from the job screen that's open, tagged with which screen drew them.
  const [drawn, setDrawn] = useState<{ key: string; shapes: Shape[] }>({ key: '', shapes: [] });
  const drawnHandlers = useRef<{ key: string; h: MapHandlers }>({ key: '', h: {} });
  // Job types: the built-in ones, plus plugins that ship their own UI. Plugins come and go while
  // the page is open (installed/removed through the fleet API): re-checked every 10 s, a UI is
  // (re)loaded when a plugin appears or its version/ui changes, dropped when it's removed.
  const [external, setExternal] = useState<JobType[]>([]);
  const [pluginList, setPluginList] = useState<PluginInfo[]>([]);
  const uiCache = useRef(new Map<string, { key: string; job: JobType | null }>());
  const syncPlugins = useCallback(async () => {
    let ps: PluginInfo[];
    try { ps = await api<PluginInfo[]>('GET', '/plugins'); } catch { return; }
    setPluginList(ps);
    const cache = uiCache.current;
    const want = ps.filter(p => !BUILTIN_JOBS.some(j => j.id === p.id));
    let changed = Array.from(cache.keys()).some(id => !want.some(p => p.id === id));
    for (const id of Array.from(cache.keys())) if (!want.some(p => p.id === id)) cache.delete(id);
    for (const p of want) {
      const key = [p.version, p.ui, p.name].join('|');
      const have = cache.get(p.id);
      if (have && have.key === key && (have.job || !p.ui)) continue;   // a UI that failed to load is retried
      const job = await loadPluginUi(p);
      if (have && have.key === key && !have.job && !job) continue;
      cache.set(p.id, { key, job });
      changed = true;
    }
    if (changed) setExternal(want.map(p => cache.get(p.id)?.job).filter((x): x is JobType => !!x));
  }, []);
  useEffect(() => { syncPlugins(); const t = setInterval(syncPlugins, 10000); return () => clearInterval(t); }, [syncPlugins]);
  const JOBS = useMemo(() => [...BUILTIN_JOBS, ...external], [external]);
  const [menu, setMenu] = useState<MenuTab>('controls');
  const [jobPick, setJobPick] = useState('patrol');      // job type shown in the Job tab when the drone is idle
  const [swapped, setSwapped] = useState(false);         // camera big, map small
  const [full, setFull] = useState<'map' | 'camera' | null>(null);
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') setFull(null); };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, []);
  const [patrols, setPatrols] = useState<Record<string, PatrolStatus>>({});
  const [jobs, setJobs] = useState<Record<string, Job>>({});
  const [jobHistory, setJobHistory] = useState<Job[]>([]);
  const [openJob, setOpenJob] = useState('');   // Reports: which finished job is open ('' = newest, '-' = none)
  useEffect(() => { setOpenJob(''); }, [selected]);
  const [target, setTarget] = useState<LatLon | null>(null);
  const [log, setLog] = useState<LogEntry[]>([]);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ text: string; ok: boolean } | null>(null);
  const noteTimer = useRef<ReturnType<typeof setTimeout>>();

  // Keep a valid selection.
  useEffect(() => {
    if (fleet.names.length && !fleet.names.includes(selected)) setSelected(fleet.names[0]);
  }, [fleet.names.join(','), selected]); // eslint-disable-line react-hooks/exhaustive-deps

  const patrol: PatrolStatus | null = patrols[selected] || null;

  // New drone selected: drop click modes and per-drone markers; open the tab of the job it's doing.
  useEffect(() => { if (mode !== 'pick' && pickRef.current) { pickRef.current.done(null); pickRef.current = null; } }, [mode]);
  useEffect(() => {
    setMode('none'); setTarget(null); setOrbit(null);
  }, [selected]); // eslint-disable-line react-hooks/exhaustive-deps

  const d: FleetDrone | undefined = fleet.drones[selected];
  const home = homeOf(d);
  const mine = d?.controller === operator;
  const flying = !!d?.armed && (d?.position.altitude ?? 0) > 1;

  // Drop the orbit circle once PX4 is no longer orbiting (hold, RTL, land, failsafe...).
  const orbitSince = useRef(0);
  useEffect(() => { if (orbit) orbitSince.current = Date.now(); }, [orbit]);
  useEffect(() => {
    if (orbit && d && Date.now() - orbitSince.current > 4000 && !(d.mode || '').toUpperCase().includes('ORBIT')) setOrbit(null);
  }, [d?.mode, orbit]); // eslint-disable-line react-hooks/exhaustive-deps

  const say = (text: string, ok: boolean) => {
    setNote({ text, ok });
    if (noteTimer.current) clearTimeout(noteTimer.current);
    noteTimer.current = setTimeout(() => setNote(null), 6000);
  };

  const loadLog = useCallback(() => {
    api<LogEntry[]>('GET', '/log?limit=40')
      .then(e => setLog([...e].sort((a, b) => (a.time < b.time ? 1 : -1))))
      .catch(() => {});
  }, []);
  useEffect(() => { loadLog(); const t = setInterval(loadLog, 3000); return () => clearInterval(t); }, [loadLog]);

  // Onboard mission progress for every drone (the fleet list shows it).
  const namesKey = fleet.names.join(',');
  useEffect(() => {
    if (!namesKey) return;
    let alive = true;
    const poll = () => {
      namesKey.split(',').forEach(n => api<PatrolStatus>('GET', `/drones/${n}/patrol`)
        .then(p => alive && setPatrols(prev => ({ ...prev, [n]: p }))).catch(() => {}));
      api<Record<string, Job>>('GET', '/jobs/active').then(j => alive && setJobs(j || {})).catch(() => {});
    };
    poll();
    const t = setInterval(poll, 2000);
    return () => { alive = false; clearInterval(t); };
  }, [namesKey]);

  const run = async (label: string, fn: () => Promise<{ message?: string }>) => {
    setBusy(true);
    try {
      const r = await fn();
      say(`${label}: ${r.message || 'ok'}`, true);
      return true;
    } catch (e: any) {
      say(`${label} failed: ${e?.message || e}`, false);
      return false;
    } finally {
      setBusy(false);
      loadLog();
    }
  };


  const takeControl = (force = false) => run('Take control', () => api('POST', `/drones/${selected}/control`, { force }));
  const releaseControl = () => run('Release', () => api('DELETE', `/drones/${selected}/control`));
  const takeoff = () => run('Take off', () => command(selected, 'takeoff', { altitude }));
  const land = () => run('Land', () => command(selected, 'land'));
  const goHome = () => { setOrbit(null); return run('Return home', () => command(selected, 'return_home')); };
  const hold = () => { setOrbit(null); return run('Hold', () => command(selected, 'hold')); };
  const kill = () => {
    if (window.confirm(`KILL ${selected}? Motors stop and it falls. Emergencies only.`)) run('Kill', () => command(selected, 'kill'));
  };

  // Which job screen is open: drawings (and click listeners) only count while it still is.
  const viewKey = `${selected}:${menu}:${(jobs[selected] && jobs[selected].id) || jobPick}`;
  // The property fence, if the selected drone's home is inside it; else PX4's circle.
  const poly = fenceInfo?.fence && fenceInfo.drones[selected]?.applies ? fenceInfo.fence : null;
  const onMapClick = async (p: LatLon) => {
    const listener = drawnHandlers.current.key === viewKey ? drawnHandlers.current.h.onClick : undefined;
    const editingSite = menu === 'dev' && mapOrigin;
    if (editingSite) {   // drawing a geofence at its own site: meters from there, no drone checks
      const q = toLocal(mapOrigin, p);
      if (mode === 'none') listener?.({ north: Math.round(q.north * 10) / 10, east: Math.round(q.east * 10) / 10 });
      return;
    }
    if ((mode === 'none' && !listener) || !home) return;
    const { north, east } = toLocal(home, p);
    const n = Math.round(north * 10) / 10, e = Math.round(east * 10) / 10;
    const fenceR = config?.geofence.radius_m;
    if (poly) {
      // the drone's property fence (the fleet API checks again, with a margin and the path there)
      if (mode !== 'none' && (!insidePolygon(p, poly.inclusion) || poly.exclusions.some(x => insidePolygon(p, x)))) {
        say('That point is outside the geofence (or in a no-fly area)', false);
        return;
      }
    } else if (fenceR && Math.hypot(north, east) > fenceR - 5) {
      say(`That point is ${Math.round(Math.hypot(north, east))} m from home, outside the ${fenceR} m geofence`, false);
      return;
    }
    if (mode === 'none') { listener?.({ north: n, east: e }); return; }
    if (mode === 'pick') { const pk = pickRef.current; pickRef.current = null; setMode('none'); pk?.done({ north: n, east: e }); return; }
    setMode('none');
    if (mode === 'orbit') {
      const ok = await run('Orbit', () => command(selected, 'orbit', { north: n, east: e, radius: orbitRadius, speed: orbitSpeed, altitude }));
      if (ok) { setOrbit({ center: p, radius: orbitRadius }); setTarget(null); }
      return;
    }
    setOrbit(null);
    setTarget(p);
    await run('Go to', () => command(selected, 'goto', { north: n, east: e, altitude }));
  };

  const job: Job | null = jobs[selected] || null;
  const patrolling = job?.plugin === 'patrol' || !!(patrol?.running || patrol?.paused);
  useEffect(() => {
    if (!selected || menu !== 'reports') return;
    let alive = true;
    const load = () => api<Job[]>('GET', `/jobs?drone=${selected}&limit=10`).then(h => alive && setJobHistory(h)).catch(() => {});
    load();
    const t = setInterval(load, 5000);
    return () => { alive = false; clearInterval(t); };
  }, [selected, menu]);

  const hint = mode === 'goto' ? `Click the map: ${selected} flies there at ${altitude} m`
    : mode === 'orbit' ? `Click the point ${selected} should circle (radius ${orbitRadius} m, nose to the centre)`
    : mode === 'pick' ? pickPrompt
    : (drawnHandlers.current.key === viewKey && drawnHandlers.current.h.onClick && drawnHandlers.current.h.clickHint) || null;

  const planKey = `${selected}:${jobPick}`;
  const ctx: AppCtx = {
    drone: selected, d, home, operator, busy, run, returnHome: goHome, mission: patrol, job,
    map: {
      pick: prompt => new Promise(done => {
        pickRef.current?.done(null);
        pickRef.current = { prompt, done };
        setPickPrompt(prompt);
        setMode('pick');
      }),
      draw: (shapes, handlers) => {
        drawnHandlers.current = { key: viewKey, h: handlers || {} };
        setDrawn({ key: viewKey, shapes: Array.isArray(shapes) ? shapes : [] });
      },
    },
    api,
    geofenceRadius: config?.geofence.radius_m ?? null,
  };
  // One job per drone: the one it's doing now, if any.
  const jobStates = JOBS.map(j => j.useActive(ctx));
  const activeIdx = jobStates.findIndex(x => x != null);
  const activeJob = activeIdx >= 0 ? JOBS[activeIdx] : null;
  const picked: JobType | undefined = JOBS.find(j => j.id === jobPick) || JOBS[0];

  // On the map: the active job's overlay (any tab), plus what the open job screen drew.
  const own = drawn.key === viewKey ? drawn.shapes : [];
  // What the selected drone's object detector sees, placed on the ground (when the camera geometry is known).
  const DET_COLOR: Record<string, string> = { person: '#f85149', car: '#58a6ff', truck: '#58a6ff', bus: '#58a6ff' };
  // Confirmed tracks only (seen in several frames at the same spot), so one-frame false positives stay off the map.
  const seen: Shape[] = (d?.detections?.tracks || []).filter(t => t.ground).map(t => ({
    type: 'marker' as const, north: t.ground!.north, east: t.ground!.east,
    color: DET_COLOR[t.label] || '#3fb950',
    label: `${t.label} ${Math.round(t.score * 100)}%, seen ${t.seen}x over ${Math.round(t.since)} s (by ${selected})`,
  }));
  const overlays: Shape[] = [
    ...((activeJob?.overlay && (own.length === 0 || menu !== 'job') && activeJob.overlay(ctx)) || []),
    ...own,
    ...seen,
  ];
  const onShape = (sh: Shape, ev: { kind: 'click' } | { kind: 'edit'; points: Array<[number, number]> }) => {
    const h = drawnHandlers.current.key === viewKey ? drawnHandlers.current.h : {};
    if (h.onShape) h.onShape(sh, ev);
    else if (activeJob) setMenu('job');   // the job's own screen knows what to do with it
  };

  const online = fleet.names.filter(n => fleet.drones[n]?.online).length;

  const viewTools = (which: 'map' | 'camera') => (
    <div className="vw-tools">
      <button title="Swap map and camera" onClick={() => setSwapped(x => !x)}>⇄</button>
      <button title={full === which ? 'Exit full screen (Esc)' : 'Full screen'} onClick={() => setFull(f => (f === which ? null : which))}>{full === which ? 'Exit' : 'Full'}</button>
    </div>
  );
  const mapSlot = swapped ? 'vw-mini' : 'vw-main';
  const camSlot = swapped ? 'vw-main' : 'vw-mini';

  const controls = (
    <div className="mn-block">
      <div className="cc-control">
        {mine ? (
          <><span className="ok">You have control</span><button onClick={releaseControl} disabled={busy}>Release</button></>
        ) : d?.controller ? (
          <><span className="warn">Controlled by {d.controller}</span><button onClick={() => takeControl(true)} disabled={busy}>Take over</button></>
        ) : (
          <><span>Nobody has control. Your first command takes it.</span><button onClick={() => takeControl()} disabled={busy || !selected}>Take control</button></>
        )}
      </div>
      <div className="cc-row">
        <label>Altitude</label>
        <input type="number" min={2} max={120} value={altitude} onChange={e => setAltitude(Math.max(2, Math.min(120, Number(e.target.value) || 0)))} /> m
        <button className="go" onClick={takeoff} disabled={busy || !selected || flying}>Take off</button>
      </div>
      {altitude < 45 && <div className="cc-warnline">Trees in the sim reach ~40 m.</div>}
      <div className="cc-buttons">
        <button className={mode === 'goto' ? 'armed' : ''} onClick={() => setMode(m => (m === 'goto' ? 'none' : 'goto'))} disabled={busy || !flying || !home}>
          {mode === 'goto' ? 'Cancel go-to' : 'Go to (click map)'}
        </button>
        <button onClick={land} disabled={busy || !d?.armed}>Land here</button>
      </div>
      <div className="cc-row">
        <button className={mode === 'orbit' ? 'armed' : ''} onClick={() => setMode(m => (m === 'orbit' ? 'none' : 'orbit'))} disabled={busy || !flying || !home}>
          {mode === 'orbit' ? 'Cancel orbit' : 'Orbit (click map)'}
        </button>
        <span className="cc-ctl-small">r <input type="number" min={5} max={300} value={orbitRadius} onChange={e => setOrbitRadius(Math.max(5, Math.min(300, Number(e.target.value) || 5)))} /> m
          {' '}at <input type="number" min={1} max={10} step={0.5} value={orbitSpeed} onChange={e => setOrbitSpeed(Math.max(1, Math.min(10, Number(e.target.value) || 1)))} /> m/s</span>
      </div>
    </div>
  );

  const status = (
    <div className="mn-block">
      {/* Only what the fleet card doesn't already show (altitude, speed, battery, from home, pilot are there). */}
      <div className="cc-stats">
        <div><label>Mode</label>{d?.mode || '–'}</div>
        <div><label>GPS</label>{d?.gps.valid ? (d.gps.satellites ? `${d.gps.satellites} sats` : 'ok') : 'no fix'}</div>
        <div><label>Heading</label>{d?.position.heading != null ? `${fmt(((d.position.heading % 360) + 360) % 360, 0)}° ${compass(d.position.heading)}` : '–'}</div>
        <div><label>Tilt</label>{d?.attitude && d.attitude.roll != null && d.attitude.pitch != null ? `${fmt(Math.max(Math.abs(d.attitude.roll), Math.abs(d.attitude.pitch)), 0)}°` : '–'}</div>
        <div><label>Position</label>{d?.position_health?.trusted == null ? '–' : d.position_health.trusted ? 'trusted' : <span className="warn">not trusted</span>}</div>
      </div>
      <div className="cc-hint" style={{ marginTop: 6 }}>
        Onboard job modes: {d?.capabilities == null ? 'not reported (older drone_core)'
          : d.capabilities.modes.length ? d.capabilities.modes.map(m => `${m.name} ${m.registered && m.heartbeat_fresh ? '✓' : '✗ (not running)'}`).join(', ') : 'none'}
      </div>
      {d?.online && d.position_health?.trusted === false && (
        <div className="cc-failsafe">PX4 doesn't trust its position{d.position_health.warnings.length ? ': ' + d.position_health.warnings.map(w => w.replace(/_/g, ' ')).join(', ') : ''}. Go-to and patrol may be unsafe.</div>
      )}
    </div>
  );

  const jobView = activeJob ? (
    <>
      <div className="mn-head">{activeJob.name} <span className="cc-sub">{jobStates[activeIdx]}</span></div>
      <activeJob.Live ctx={ctx} />
    </>
  ) : (
    <>
      <div className="mn-head">No job <span className="cc-sub">{selected} is free. Start one:</span></div>
      <div className="mn-seg">
        {JOBS.map(j => <button key={j.id} className={picked?.id === j.id ? 'sel' : ''} onClick={() => setJobPick(j.id)}>{j.name}</button>)}
      </div>
      {picked ? <picked.Planner key={planKey} ctx={ctx} /> : <div className="cc-hint">Loading job types from the plugins…</div>}
    </>
  );

  const reports = (
    <>
      <div className="mn-block">
        {!jobHistory.length && <div className="cc-hint">No finished jobs yet.</div>}
        {jobHistory.map(j => {
          const type = JOBS.find(x => x.id === j.plugin);
          const open = (openJob || jobHistory[0]?.id) === j.id;
          return (
            <div key={j.id} className={`cc-jobitem${open ? ' open' : ''}`}>
              <button className="cc-jobrow" onClick={() => setOpenJob(open ? '-' : j.id)}>
                <span className="t">{clock(j.ended || j.started)}</span>
                <span>{type?.name || j.plugin}</span>
                <span className={`cc-pill ${j.result === 'completed' ? 'ok' : j.result === 'failed' ? 'bad' : 'warn'}`}>{j.result}</span>
                <span className="cc-sub" title={j.reason}>{j.reason}</span>
              </button>
              {open && (
                <div className="cc-jobreport">
                  <div className="cc-hint">{j.reason}{j.operator ? ` · started by ${j.operator}` : ''}</div>
                  {type?.Report && <type.Report ctx={ctx} job={j} />}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </>
  );

  const dev = (
    <>
      <GeofenceAdmin info={fenceInfo} reload={loadFence} home={home} drone={selected} admin={role === 'admin'} map={ctx.map} note={say} setOrigin={setMapOrigin} />
      {role === 'admin' && <OperatorAdmin me={operator} note={say} />}
      <PluginAdmin plugins={pluginList} reload={syncPlugins} note={say} />
      <DevState drone={selected} d={d} connected={fleet.connected} socket={fleet.socket} />
    </>
  );

  return (
    <div className={`cc${full ? ' cc-has-full' : ''}`}>
      <header className="cc-header">
        <div className="cc-brand">DRONEOS <span>Command Center</span></div>
        <div className="cc-link">
          <span className={`dot ${fleet.socket ? 'ok' : 'bad'}`} /> fleet API
          <span className={`dot ${fleet.connected ? 'ok' : 'bad'}`} /> drones {online}/{fleet.names.length} online
        </div>
      </header>

      <div className="cc-grid">
        <aside className="cc-fleet">
          <div className="cc-section">Fleet</div>
          {fleet.names.map(n => {
            const x = fleet.drones[n];
            const s = statusOf(x, patrols[n]);
            const mv = motion(x);
            const h = homeOf(x);
            const fh = x && h && x.gps.lat != null && x.gps.lon != null ? distance(h, { lat: x.gps.lat, lon: x.gps.lon }) : null;
            const air = !!x?.armed;
            return (
              <button key={n} className={`cc-drone ${n === selected ? 'sel' : ''}`} onClick={() => setSelected(n)}>
                <div className="cc-drone-top">
                  <span className="cc-drone-name">{n}</span>
                  <span className={`cc-pill ${s.tone}`}>{s.label}</span>
                </div>
                <div className={`cc-drone-doing ${s.tone}`}>{doing(x, patrols[n], jobs[n])}</div>
                <div className="cc-drone-nums">
                  <div><label>Alt</label>{fmt(x?.position.altitude, 0)} m</div>
                  <div><label>Speed</label>{air ? `${fmt(mv.speed, 1)} m/s` : '–'}</div>
                  <div><label>Going</label>{air && mv.course != null
                    ? <span><span className="cc-arrow" style={{ transform: `rotate(${mv.course}deg)` }}>↑</span> {compass(mv.course)}</span>
                    : air && Math.abs(mv.climb) > 0.4 ? (mv.climb > 0 ? 'up' : 'down') : '–'}</div>
                  <div><label>Battery</label>{fmt(x?.battery.percent)}%</div>
                  <div><label>From home</label>{fmt(fh, 0)} m</div>
                  <div><label>Pilot</label>{x?.controller || '–'}</div>
                </div>
              </button>
            );
          })}
          {!fleet.names.length && <div className="cc-empty">No drones reporting</div>}
        </aside>

        <div className={`vw ${mapSlot}${full === 'map' ? ' vw-full' : ''}`}>
          <FleetMap drones={fleet.drones} names={fleet.names} selected={selected} onSelect={setSelected}
                    onMapClick={onMapClick} clickHint={hint} target={target}
                    fence={poly ? { polygon: poly.inclusion, exclusions: poly.exclusions }
                      : home && config ? { center: home, radius: config.geofence.radius_m } : null}
                    orbit={orbit} overlays={overlays} onShape={onShape} origin={menu === 'dev' ? mapOrigin : null} />
          {viewTools('map')}
        </div>

        <div className={`vw ${camSlot}${full === 'camera' ? ' vw-full' : ''}`}>
          <Camera drone={selected} det={d?.detections} />
          {viewTools('camera')}
        </div>

        <section className="mn">
          <div className="mn-icons">
            {MENU.map(m => (
              <button key={m.id} title={m.name} className={menu === m.id ? 'sel' : ''} onClick={() => setMenu(m.id)}>
                <span>{m.icon}</span>{m.id === 'job' && activeJob && <i className="mn-dot" />}
              </button>
            ))}
          </div>
          <div className="mn-drone">
            <span className="cc-drone-name">{selected || '—'}</span>
          </div>
          <div className="mn-body">
            {menu === 'controls' ? controls : menu === 'status' ? status : menu === 'job' ? jobView : menu === 'reports' ? reports : dev}
          </div>
          <div className="mn-safety">
            <button onClick={hold} disabled={busy || !d?.armed} title="Stop and hover here">Hold</button>
            <button className="warn" onClick={goHome} disabled={busy || !d?.armed}>Return home</button>
            <button className="kill" onClick={kill} disabled={busy || !d?.armed}>Kill motors</button>
          </div>
        </section>

        <footer className="cc-log">
          <div className="cc-section">Activity</div>
          <div className="cc-log-rows">
            {collapse(log).map(({ e, n }, i) => (
              <div key={i} className={`cc-log-row ${e.ok ? '' : 'fail'}`}>
                <span className="t">{clock(e.time)}</span>
                <span className="op">{e.operator}</span>
                <span className="dr">{e.drone}</span>
                <span className="cmd">{describe(e)}{n > 1 && <span className="cc-sub"> ×{n}</span>}</span>
                <span className="msg">{e.ok ? (e.message || 'ok') : `✗ ${e.message || 'failed'}`}</span>
              </div>
            ))}
            {!log.length && <div className="cc-empty">No commands yet</div>}
          </div>
        </footer>
      </div>

      {note && <div className={`cc-note ${note.ok ? 'ok' : 'bad'}`}>{note.text}</div>}
    </div>
  );
};

/** Activity rows: the same command from the same operator to the same drone, back to back (a plugin
 *  steering: search turning on the spot, follow re-aiming every second; PX4 repeating itself), is
 *  one row with a count; the newest one is shown. */
function collapse(log: LogEntry[]): Array<{ e: LogEntry; n: number }> {
  const out: Array<{ e: LogEntry; n: number }> = [];
  for (const e of log) {
    const last = out[out.length - 1];
    if (last && last.e.operator === e.operator && last.e.drone === e.drone && last.e.ok === e.ok && last.e.command === e.command) last.n += 1;
    else out.push({ e, n: 1 });
  }
  return out;
}

/** Dev tab: what the fleet API gets from drone_core for this drone, unfiltered. */
const DevState: React.FC<{ drone: string; d?: FleetDrone; connected: boolean; socket: boolean }> = ({ drone, d, connected, socket }) => {
  const [health, setHealth] = useState<any>(null);
  useEffect(() => { fetch('/api/v1/health').then(r => r.json()).then(setHealth).catch(() => setHealth(null)); }, [drone]);
  return (
    <div className="mn-block">
      <div className="cc-hint">Telemetry socket {socket ? 'open' : 'closed'} · fleet API {connected ? 'connected to drone_core' : 'not connected'}{health ? ` · ${health.drones} drones` : ''}</div>
      <pre className="mn-raw">{d ? JSON.stringify(d.raw ?? d, null, 1) : 'no data'}</pre>
    </div>
  );
};

export default CommandCenter;
