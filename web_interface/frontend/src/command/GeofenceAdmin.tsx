// Dev tab: the property geofence. Drag the red outline onto the property lines (right-click a
// corner to remove it, click the map to add one), add no-fly areas (house, neighbours), set the
// height limit, save. The fleet API refuses anything outside it; the drone side loads it into PX4.
import React, { useEffect, useState } from 'react';
import { api } from '../api/fleet';
import { LatLon, toLatLon, toLocal } from './geo';
import { Shape, MapHandlers } from './apps/registry';

export interface FenceInfo {
  fence: { inclusion: [number, number][]; exclusions: [number, number][][]; max_altitude_m: number; updated?: string; by?: string } | null;
  drones: Record<string, { applies: boolean; onboard: boolean | null; onboard_error?: string | null }>;
}

type NE = [number, number];
const r1 = (v: number) => Math.round(v * 10) / 10;

const GeofenceAdmin: React.FC<{
  info: FenceInfo | null; reload: () => void; home: LatLon | null; drone: string; admin: boolean;
  map: { draw: (shapes: Shape[], h?: MapHandlers) => void }; note: (t: string, ok: boolean) => void;
  setOrigin: (p: LatLon | null) => void;   // move the map there while editing (the fence's site, not the drone's)
}> = ({ info, reload, home: droneHome, drone, admin, map, note, setOrigin }) => {
  const [site, setSite] = useState<LatLon | null>(null);   // reference point while editing
  const [where, setWhere] = useState('');                   // "lat, lon" typed by the operator
  const home = site;
  const [editing, setEditing] = useState(false);
  const [inc, setInc] = useState<NE[]>([]);
  const [exc, setExc] = useState<NE[][]>([]);
  const [alt, setAlt] = useState(60);
  const [busy, setBusy] = useState(false);
  const f = info?.fence || null;

  const start = () => {
    // Edit where the fence is; a new one where the operator typed, else around the drone's home.
    let ref: LatLon | null = null;
    if (f) {
      const n = f.inclusion.length;
      ref = { lat: f.inclusion.reduce((s, p) => s + p[0], 0) / n, lon: f.inclusion.reduce((s, p) => s + p[1], 0) / n };
    } else {
      const m = where.match(/^\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$/);
      ref = m ? { lat: Number(m[1]), lon: Number(m[2]) } : droneHome;
    }
    if (!ref) { note('Type the site as "lat, lon", or select a drone with GPS', false); return; }
    const home = ref;
    setSite(ref); setOrigin(ref);
    const loc = (p: [number, number]): NE => { const q = toLocal(home, { lat: p[0], lon: p[1] }); return [r1(q.north), r1(q.east)]; };
    if (f) { setInc(f.inclusion.map(loc)); setExc(f.exclusions.map(x => x.map(loc))); setAlt(f.max_altitude_m); }
    else { setInc([[40, -40], [40, 40], [-40, 40], [-40, -40]]); setExc([]); setAlt(60); }   // a rough square to drag into place
    setEditing(true);
  };
  useEffect(() => {
    if (!editing) { map.draw([]); return; }
    map.draw([
      { type: 'route', id: 'inc', points: inc, editable: true, closed: true, color: '#f85149' },
      ...exc.map((x, i) => ({ type: 'route' as const, id: 'exc' + i, points: x, editable: true, closed: true, color: '#d29922' })),
    ], {
      onShape: (sh, ev) => {
        if (ev.kind !== 'edit') return;
        if (sh.id === 'inc') setInc(ev.points);
        else if (sh.id && sh.id.startsWith('exc')) { const i = Number(sh.id.slice(3)); setExc(xs => xs.map((x, k) => (k === i ? ev.points : x)).filter(x => x.length >= 3)); }
      },
      clickHint: 'Drag the red corners onto the property line. To add a corner, drag a + (halfway along each side). Right-click a corner to remove it. Orange = no-fly area.',
    });
  }, [editing, JSON.stringify(inc), JSON.stringify(exc)]);

  const save = async () => {
    if (!home) return;
    const ll = (p: NE): [number, number] => { const q = toLatLon(home, p[0], p[1]); return [q.lat, q.lon]; };
    setBusy(true);
    try {
      await api('PUT', '/geofence', { inclusion: inc.map(ll), exclusions: exc.map(x => x.map(ll)), max_altitude_m: alt });
      note('Geofence saved', true); setEditing(false); setOrigin(null); reload();
    } catch (e) { note((e as Error).message, false); }
    setBusy(false);
  };
  const remove = async () => {
    if (!window.confirm('Remove the geofence? Drones keep only PX4\'s 300 m circle.')) return;
    setBusy(true);
    try { await api('DELETE', '/geofence'); note('Geofence removed', true); setEditing(false); setOrigin(null); reload(); } catch (e) { note((e as Error).message, false); }
    setBusy(false);
  };

  const ds = Object.entries(info?.drones || {});
  const on = ds.filter(([, s]) => s.applies);
  const loaded = on.filter(([, s]) => s.onboard).map(([n]) => n);
  const failed = on.filter(([, s]) => s.onboard_error).map(([n, s]) => `${n} (${s.onboard_error})`);
  const pending = on.filter(([, s]) => !s.onboard && !s.onboard_error).map(([n]) => n);
  const status = [on.length ? 'Applies to ' + on.map(([n]) => n).join(', ') : 'No drone has its home inside it.',
    loaded.length ? 'in PX4 on ' + loaded.join(', ') : '', failed.length ? 'PX4 refused it on ' + failed.join(', ') : '',
    pending.length && on.length ? (pending.length === on.length ? 'not loaded into PX4 yet' : 'not in PX4 yet on ' + pending.join(', ')) : '']
    .filter(Boolean).join(' · ');
  return (
    <div className="mn-block">
      <div className="mn-title">Geofence <span className="cc-sub">{f ? `${f.inclusion.length} corners · ${f.exclusions.length} no-fly · ${f.max_altitude_m} m` : 'none: PX4 300 m circle only'}</span></div>
      {f && !editing && <div className="cc-hint">{status}</div>}
      {editing ? (
        <>
          <div className="cc-row"><label>Max height</label>
            <input type="number" min={5} max={120} value={alt} onChange={e => setAlt(Math.max(5, Math.min(120, Number(e.target.value) || 5)))} /> m</div>
          <div className="cc-buttons">
            <button onClick={() => setExc(xs => [...xs, [[8, -8], [8, 8], [-8, 8], [-8, -8]].map(([n, e]) => [n + 20, e] as NE)])}>Add no-fly area</button>
            {exc.length > 0 && <button onClick={() => setExc(xs => xs.slice(0, -1))}>Remove last no-fly</button>}
          </div>
          <div className="cc-buttons">
            <button className="go" onClick={save} disabled={busy || inc.length < 3}>Save</button>
            <button onClick={() => { setEditing(false); setOrigin(null); }} disabled={busy}>Cancel</button>
          </div>
        </>
      ) : admin ? (
        <div className="cc-buttons">
          {!f && <input placeholder="site lat, lon (blank = drone's home)" value={where} onChange={e => setWhere(e.target.value)} style={{ width: 220 }} />}
          <button onClick={start}>{f ? 'Edit on map' : 'Draw on map'}</button>
          {f && <button className="warn" onClick={remove} disabled={busy}>Remove</button>}
        </div>
      ) : null}

    </div>
  );
};

export default GeofenceAdmin;
