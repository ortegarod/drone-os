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
import { PatrolStatus, patrolAt, patrolTotal } from './status';
import CameraView from './CameraView';
import FleetList, { compass, fmt } from './FleetList';
import ActivityLog, { LogEntry } from './ActivityLog';
import DevState from './DevState';
import './CommandCenter.css';

type ClickMode = 'none' | 'goto' | 'orbit' | 'pick';
type MenuTab = 'controls' | 'status' | 'job' | 'reports' | 'dev';
const MENU: Array<{ id: MenuTab; icon: string; name: string }> = [
  { id: 'controls', icon: 'Fly',     name: 'Flight controls' },
  { id: 'status',   icon: 'Status',  name: 'Drone status' },
  { id: 'job',      icon: 'Job',     name: 'Job' },
  { id: 'reports',  icon: 'Reports', name: 'Reports' },
  { id: 'dev',      icon: 'Dev',     name: 'Dev: operators, plugins, raw state' },
];
interface Config { geofence: { radius_m: number; max_altitude_m: number }; max_speed_mps: number }

const clock = (iso: string) => { const t = new Date(iso); return isNaN(t.getTime()) ? iso : t.toLocaleTimeString([], { hour12: false }); };

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
  const [mapOrigin, setMapOrigin] = useState<LatLon | null>(null);
  const loadFence = useCallback(() => { api<FenceInfo>('GET', '/geofence').then(setFenceInfo).catch(() => {}); }, []);
  useEffect(() => { loadFence(); const t = setInterval(loadFence, 15000); return () => clearInterval(t); }, [loadFence]);
  const [mode, setMode] = useState<ClickMode>('none');
  const pickRef = useRef<{ prompt: string; done: (p: { north: number; east: number } | null) => void } | null>(null);
  const [pickPrompt, setPickPrompt] = useState('');
  const [drawn, setDrawn] = useState<{ key: string; shapes: Shape[] }>({ key: '', shapes: [] });
  const drawnHandlers = useRef<{ key: string; h: MapHandlers }>({ key: '', h: {} });
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
      if (have && have.key === key && (have.job || !p.ui)) continue;
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
  const [jobPick, setJobPick] = useState('patrol');
  const [swapped, setSwapped] = useState(false);
  const [full, setFull] = useState<'map' | 'camera' | null>(null);
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') setFull(null); };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, []);
  const [patrols, setPatrols] = useState<Record<string, PatrolStatus>>({});
  const [jobs, setJobs] = useState<Record<string, Job>>({});
  const [jobHistory, setJobHistory] = useState<Job[]>([]);
  const [openJob, setOpenJob] = useState('');
  useEffect(() => { setOpenJob(''); }, [selected]);
  const [target, setTarget] = useState<LatLon | null>(null);
  const [log, setLog] = useState<LogEntry[]>([]);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ text: string; ok: boolean } | null>(null);
  const noteTimer = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => {
    if (fleet.names.length && !fleet.names.includes(selected)) setSelected(fleet.names[0]);
  }, [fleet.names.join(','), selected]); // eslint-disable-line react-hooks/exhaustive-deps

  const patrol: PatrolStatus | null = patrols[selected] || null;

  useEffect(() => { if (mode !== 'pick' && pickRef.current) { pickRef.current.done(null); pickRef.current = null; } }, [mode]);
  useEffect(() => { setMode('none'); setTarget(null); setOrbit(null); }, [selected]); // eslint-disable-line react-hooks/exhaustive-deps

  const d: FleetDrone | undefined = fleet.drones[selected];
  const home = homeOf(d);
  const mine = d?.controller === operator;
  const flying = !!d?.armed && (d?.position.altitude ?? 0) > 1;

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

  const viewKey = `${selected}:${menu}:${(jobs[selected] && jobs[selected].id) || jobPick}`;
  const poly = fenceInfo?.fence && fenceInfo.drones[selected]?.applies ? fenceInfo.fence : null;

  const onMapClick = async (p: LatLon) => {
    const listener = drawnHandlers.current.key === viewKey ? drawnHandlers.current.h.onClick : undefined;
    const editingSite = menu === 'dev' && mapOrigin;
    if (editingSite) {
      const q = toLocal(mapOrigin, p);
      if (mode === 'none') listener?.({ north: Math.round(q.north * 10) / 10, east: Math.round(q.east * 10) / 10 });
      return;
    }
    if ((mode === 'none' && !listener) || !home) return;
    const { north, east } = toLocal(home, p);
    const n = Math.round(north * 10) / 10, e = Math.round(east * 10) / 10;
    const fenceR = config?.geofence.radius_m;
    if (poly) {
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
  const jobStates = JOBS.map(j => j.useActive(ctx));
  const activeIdx = jobStates.findIndex(x => x != null);
  const activeJob = activeIdx >= 0 ? JOBS[activeIdx] : null;
  const picked: JobType | undefined = JOBS.find(j => j.id === jobPick) || JOBS[0];

  const own = drawn.key === viewKey ? drawn.shapes : [];
  const DET_COLOR: Record<string, string> = { person: '#f85149', car: '#58a6ff', truck: '#58a6ff', bus: '#58a6ff' };
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
    else if (activeJob) setMenu('job');
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

  // ---- Tab panels ----

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
        <FleetList
          names={fleet.names}
          drones={fleet.drones}
          selected={selected}
          onSelect={setSelected}
          patrols={patrols}
          jobs={jobs}
        />

        <div className={`vw ${mapSlot}${full === 'map' ? ' vw-full' : ''}`}>
          <FleetMap drones={fleet.drones} names={fleet.names} selected={selected} onSelect={setSelected}
                    onMapClick={onMapClick} clickHint={hint} target={target}
                    fence={poly ? { polygon: poly.inclusion, exclusions: poly.exclusions }
                      : home && config ? { center: home, radius: config.geofence.radius_m } : null}
                    orbit={orbit} overlays={overlays} onShape={onShape} origin={menu === 'dev' ? mapOrigin : null} />
          {viewTools('map')}
        </div>

        <div className={`vw ${camSlot}${full === 'camera' ? ' vw-full' : ''}`}>
          <CameraView drone={selected} det={d?.detections} />
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

        <ActivityLog log={log} />
      </div>

      {note && <div className={`cc-note ${note.ok ? 'ok' : 'bad'}`}>{note.text}</div>}
    </div>
  );
};

export default CommandCenter;
