// Patrol plugin UI, served by the patrol service (manifest "ui": "/ui/job.js") and loaded by the
// Command Center. Plain ES module; React and helpers come from window.DroneOS.
//
// - Planner: the drone's shared route, drawn on the map as draggable points (the AI edits the
//   same route with `droneos route`); altitude, speed, loops; Start.
// - Live: progress from the drone (ctx.mission), pause/resume, the report filling in, photo spots.
// - Report: one finished patrol's report with photos (Reports tab).
const { React, h, api, blobUrl } = window.DroneOS;
const { useState, useEffect, useMemo } = React;
const P = '/plugins/patrol';

// -- shared route store (one poll for every screen and for overlay()) ------------------------
let routes = {};
let lastEdit = 0;
const subs = new Set();
const emit = () => subs.forEach(f => f());
const pollRoutes = () => {
  if (Date.now() - lastEdit < 2500) return;   // don't overwrite a drag that's still being saved
  api('GET', P + '/routes').then(r => { if (Date.now() - lastEdit >= 2500) { routes = r || {}; emit(); } }).catch(() => {});
};
pollRoutes();
setInterval(pollRoutes, 2000);
function useStore() {
  const [, tick] = useState(0);
  useEffect(() => { const f = () => tick(t => t + 1); subs.add(f); return () => { subs.delete(f); }; }, []);
}
function saveRoute(ctx, points) {
  lastEdit = Date.now();
  routes = { ...routes, [ctx.drone]: { points, operator: ctx.operator, updated: new Date().toISOString() } };
  emit();
  api('PUT', P + '/drones/' + ctx.drone + '/route', { points }).then(() => { lastEdit = Date.now(); })
    .catch(e => ctx.run('Save route', () => Promise.reject(e)));
}

// The onboard mission is the points x loops plus a final return-home item.
const total = m => Math.max(1, (m.items || 1) - 1);
const at = m => Math.min((m.item || 0) + 1, total(m));
const clock = iso => { if (!iso) return ''; const t = new Date(iso); return isNaN(t.getTime()) ? iso : t.toLocaleTimeString([], { hour12: false }); };
const day = iso => new Date(iso).toLocaleDateString([], { month: 'short', day: 'numeric' });
const num = (v, set, min, max, step) => h('input', { type: 'number', value: v, min, max, step: step || 1,
  onChange: e => set(Math.max(min, Math.min(max, Number(e.target.value) || min))) });

// -- Planner -------------------------------------------------------------------------------
function Planner({ ctx }) {
  useStore();
  const [adding, setAdding] = useState(false);
  const [alt, setAlt] = useState(50);      // trees in the sim reach ~40 m
  const [speed, setSpeed] = useState(5);
  const [loops, setLoops] = useState(1);
  const r = routes[ctx.drone] || { points: [] };
  const route = r.points || [];
  useEffect(() => {
    ctx.map.draw(route.length ? [{ type: 'route', id: 'route', points: route, editable: true }] : [], {
      onShape: (sh, ev) => { if (ev.kind === 'edit') saveRoute(ctx, ev.points); },
      onClick: adding ? p => saveRoute(ctx, [...(routes[ctx.drone] || { points: [] }).points, [Math.round(p.north * 10) / 10, Math.round(p.east * 10) / 10]]) : undefined,
      clickHint: 'Click the map to add patrol points for ' + ctx.drone + ' (' + route.length + ' so far). Drag a point to move it, right-click to remove.',
    });
  }, [JSON.stringify(route), adding, ctx.drone]);
  const length = useMemo(() => {
    let m = 0;
    for (let i = 0; route.length > 1 && i < route.length; i++) {
      const a = route[i], b = route[(i + 1) % route.length];
      m += Math.hypot(a[0] - b[0], a[1] - b[1]);
    }
    return m;
  }, [JSON.stringify(route)]);
  const pm = ctx.d && ctx.d.capabilities && ctx.d.capabilities.modes.find(m => m.name === 'PATROL');
  const noMode = ctx.d && ctx.d.capabilities && !(pm && pm.registered && pm.heartbeat_fresh);
  const start = () => ctx.run('Patrol', () => api('POST', '/drones/' + ctx.drone + '/job', { plugin: 'patrol', args: { route, altitude: alt, loops, speed } })
    .then(j => { setAdding(false); return { message: 'started' + (j.text ? ': ' + j.text : '') }; }));
  return h('div', { className: 'mn-block' },
    h('div', { className: 'mn-title' }, 'Route', h('span', { className: 'cc-sub' }, route.length ? route.length + ' points' + (r.operator ? ' · by ' + r.operator : '') : 'none yet')),
    h('div', { className: 'cc-buttons' },
      h('button', { className: adding ? 'armed' : '', onClick: () => setAdding(!adding), disabled: !ctx.home }, adding ? 'Done adding' : route.length ? 'Add points' : 'Draw on map'),
      h('button', { onClick: () => saveRoute(ctx, route.slice(0, -1)), disabled: !route.length }, 'Undo'),
      h('button', { onClick: () => { saveRoute(ctx, []); setAdding(false); }, disabled: !route.length }, 'Clear')),
    h('div', { className: 'cc-hint' }, adding ? 'Click the map to add points.' : route.length ? 'Drag points to move them, right-click to remove.' : 'Draw it, or ask your agent to drop points for you to drag.'),
    noMode ? h('div', { className: 'cc-warnline' }, "This drone's PATROL mode isn't running: drone_core will fly the route in OFFBOARD instead (no PX4 RTL if the patrol process dies).") : null,
    h('div', { className: 'cc-row' }, h('label', null, 'Altitude'), num(alt, setAlt, 5, 120), ' m', alt < 45 ? h('span', { className: 'cc-warnline' }, 'trees ~40 m') : null),
    h('div', { className: 'cc-row' }, h('label', null, 'Speed'), num(speed, setSpeed, 1, 10, 0.5), ' m/s',
      h('label', { style: { minWidth: 0, marginLeft: 8 } }, 'Loops'), num(loops, setLoops, 1, 20)),
    h('button', { className: 'go wide', onClick: start, disabled: ctx.busy || route.length < 2 },
      'Start patrol' + (route.length >= 2 ? ' · ' + Math.round(length * loops) + ' m, ~' + Math.max(1, Math.ceil(length * loops / speed / 60)) + ' min' : '')));
}

// -- reports ---------------------------------------------------------------------------------
function Img({ rid, n, big, onClick }) {
  const [src, setSrc] = useState('');
  useEffect(() => { let on = true; blobUrl(P + '/reports/' + rid + '/photos/' + n + '.jpg').then(u => on && setSrc(u)).catch(() => {}); return () => { on = false; }; }, [rid, n]);
  const cls = big ? 'pr-big' : 'pr-thumb';
  return src ? h('img', { src, className: cls, onClick, alt: 'point ' + n }) : h('div', { className: cls + ' empty' }, '…');
}

const STATUS = { running: 'In progress', completed: 'Completed', aborted: 'Stopped early', failed: 'Failed', replaced: 'Replaced', unknown: 'Unknown' };
const tone = s => (s === 'completed' ? 'ok' : s === 'running' ? 'busy' : s === 'failed' ? 'bad' : 'warn');

/** One report: summary, photo grid, events, a photo viewer; draws its photo spots when asked. */
function ReportView({ ctx, id, list, onPick, spots, live, bare }) {
  const [rep, setRep] = useState(null);
  const [open, setOpen] = useState(null);
  const [pinned, setPinned] = useState(false);
  useEffect(() => {
    if (!id) return;
    let on = true;
    const load = () => api('GET', P + '/reports/' + id).then(r => on && setRep(r)).catch(() => {});
    load();
    const t = setInterval(load, 3000);
    return () => { on = false; clearInterval(t); };
  }, [id]);
  const shot = rep ? rep.points.filter(p => p.photo) : [];
  const show = rep && (live || pinned);
  useEffect(() => {
    if (!spots) return;
    const shapes = [];
    if (show && rep.route && rep.route.length) shapes.push({ type: 'route', points: rep.route, kind: 'active' });
    if (show) shot.filter(p => p.lat != null).forEach(p => shapes.push({ type: 'photo', id: 'p' + p.n, n: p.n, lat: p.lat, lon: p.lon }));
    ctx.map.draw(shapes, { onShape: sh => { if (sh.type === 'photo') setOpen(sh.n); } });
  }, [show, rep && rep.id, shot.length]);
  if (!rep) return h('div', { className: 'cc-hint' }, id ? 'Loading report…' : 'No patrol reports for ' + ctx.drone + ' yet. Each patrol saves a photo at every point.');
  const reached = rep.points.filter(p => p.status === 'reached').length;
  const cur = open != null ? rep.points.find(p => p.n === open) : null;
  return h('div', { className: 'pr' },
    bare ? null : h('div', { className: 'pr-head' },
      h('span', { className: 'cc-pill ' + tone(rep.status) }, STATUS[rep.status] || rep.status),
      h('span', { className: 'cc-sub', style: { marginLeft: 0 } }, day(rep.started) + ' ' + clock(rep.started) + ' · ' + rep.operator + ' · ' + reached + '/' + rep.points.length + ' points'),
      list && list.length > 1 ? h('select', { value: rep.id, onChange: e => { onPick(e.target.value); setPinned(true); } },
        list.map(r => h('option', { key: r.id, value: r.id }, day(r.started) + ' ' + clock(r.started) + ' · ' + r.reached + '/' + r.points))) : null),
    rep.summary && !bare ? h('div', { className: 'cc-hint' }, rep.summary) : null,
    !live && spots && shot.length ? h('label', { className: 'cc-hint', style: { display: 'block', cursor: 'pointer' } },
      h('input', { type: 'checkbox', checked: pinned, onChange: e => setPinned(e.target.checked) }), ' Show photo spots on the map') : null,
    h('div', { className: 'pr-grid' }, rep.points.map(p => h('div', { key: p.n, className: 'pr-cell ' + p.status, title: p.photo_error || p.photo_note || '' },
      p.photo ? h(Img, { rid: rep.id, n: p.n, onClick: () => setOpen(p.n) }) : h('div', { className: 'pr-thumb empty' }, p.status === 'pending' ? '·' : p.status === 'missed' ? 'missed' : 'no photo'),
      h('span', null, (rep.loops > 1 ? 'L' + p.loop + ' ' : '') + 'P' + p.point + (p.status === 'off_target' ? ' · ✗ ' + p.off_target_m + ' m off' : p.time ? ' · ' + clock(p.time) : ''))))),
    rep.events.length ? h('ul', { className: 'pr-events' }, rep.events.slice(-6).map((e, i) => h('li', { key: i }, h('b', null, clock(e.time)), ' ' + e.what))) : null,
    cur ? h('div', { className: 'pr-modal', onClick: () => setOpen(null) },
      h('div', { className: 'pr-modal-box', onClick: e => e.stopPropagation() },
        h(Img, { rid: rep.id, n: cur.n, big: true }),
        h('div', { className: 'pr-modal-info' },
          h('b', null, rep.drone + ' · loop ' + cur.loop + ', point ' + cur.point),
          ' · ' + clock(cur.time) + ' · ' + (cur.altitude == null ? '–' : cur.altitude) + ' m up · N ' + cur.north + ' E ' + cur.east +
          ' (' + cur.off_target_m + ' m off target) · battery ' + (cur.battery == null ? '–' : cur.battery) + '%' + (cur.photo_note ? ' · ' + cur.photo_note : ''),
          h('span', { className: 'pr-nav' },
            h('button', { disabled: !shot.some(p => p.n < cur.n), onClick: () => setOpen(shot.filter(p => p.n < cur.n).pop().n) }, '‹ Prev'),
            h('button', { disabled: !shot.some(p => p.n > cur.n), onClick: () => setOpen(shot.find(p => p.n > cur.n).n) }, 'Next ›'),
            h('button', { onClick: () => setOpen(null) }, 'Close'))))) : null);
}


// -- Live / Report -----------------------------------------------------------------------------
function Live({ ctx }) {
  const m = ctx.mission;
  const onPoints = !!(m && (m.running || m.paused));
  const mode = String((ctx.d && ctx.d.mode) || '').toUpperCase();
  const phase = onPoints ? (m.paused ? 'Paused' : 'Patrolling') : mode.includes('RTL') || mode.includes('LAND') ? 'Heading home' : 'Starting';
  const rid = ctx.job && ctx.job.links && ctx.job.links.report;
  const cmd = (label, path) => ctx.run(label, () => api('POST', P + '/drones/' + ctx.drone + '/' + path));
  return h('div', { className: 'mn-block' },
    h('div', { className: 'mn-title' }, phase, onPoints ? h('span', { className: 'cc-sub' }, 'point ' + at(m) + ' of ' + total(m)) : null,
      ctx.job ? h('span', { className: 'cc-sub' }, ctx.job.text + ' · by ' + ctx.job.operator) : null),
    onPoints ? h('div', { className: 'cc-progress' }, h('div', { style: { width: Math.round((m.progress || 0) * 100) + '%' } })) : null,
    h('div', { className: 'cc-hint' }, m && m.paused ? 'Holding in place. Resume continues from point ' + at(m) + '.'
      : 'The patrol plugin flies this (it holds control) and lands at home after the last loop, even if this page closes. Land, Return home or taking control ends the job.'),
    h('div', { className: 'cc-buttons' },
      m && m.paused ? h('button', { className: 'go', onClick: () => cmd('Resume patrol', 'resume'), disabled: ctx.busy }, 'Resume')
        : h('button', { onClick: () => cmd('Pause patrol', 'pause'), disabled: ctx.busy || !onPoints }, 'Pause'),
      h('button', { className: 'warn', onClick: ctx.returnHome, disabled: ctx.busy }, 'Stop: return home')),
    h(ReportView, { ctx, id: rid, spots: true, live: true }));
}

// Reports tab: the patrol report of one finished job (status and time are on the job row above it).
function Report({ ctx, job }) {
  const rid = job.links && job.links.report;
  if (!rid) return h('div', { className: 'cc-hint' }, 'No report for this patrol.');
  return h(ReportView, { ctx, id: rid, spots: true, bare: true });
}

// On the map while the drone is on a patrol job (any tab): the route it's flying.
function overlay(ctx) {
  const pts = (ctx.job && ctx.job.args && ctx.job.args.route) || (routes[ctx.drone] || {}).points || [];
  return pts.length ? [{ type: 'route', points: pts, kind: 'active' }] : [];
}

// Tab badge / job header.
function status(ctx) {
  const m = ctx.mission;
  const mode = String((ctx.d && ctx.d.mode) || '').toUpperCase();
  if (m && m.running) return 'point ' + at(m) + '/' + total(m);
  if (m && m.paused) return 'paused';
  return mode.includes('RTL') || mode.includes('LAND') ? 'heading home' : 'starting';
}

export default { Planner, Live, Report, overlay, status };
