// Search plugin UI: a plain ES module the command center loads from this plugin
// (manifest "ui": "/ui/job.js"). No build step: React comes from window.DroneOS.
// Default export: { Planner, Live, Report, overlay, status }.
const { React, h, api, blobUrl } = window.DroneOS;
const { useState, useEffect } = React;
const P = '/plugins/search';
const COLOR = { person: '#f85149', car: '#58a6ff', truck: '#58a6ff', bus: '#58a6ff', motorcycle: '#58a6ff' };

const num = (v, set, min, max, step) => h('input', { type: 'number', value: v, min, max, step: step || 1,
  onChange: e => set(Math.max(min, Math.min(max, Number(e.target.value) || min))) });
const row = (label, ...kids) => h('div', { className: 'cc-row' }, h('label', null, label), ...kids);
const clock = t => (t ? t.slice(11, 19) : '');

// Look points per drone, kept while the page is open.
const plans = {};

// Reports by job id, one shared poll (overlay() can't use hooks).
const reps = {};
const subs = new Set();
let polling = null;
function poll() {
  const ids = Object.keys(reps).filter(id => reps[id].live);
  if (!ids.length) { clearInterval(polling); polling = null; return; }
  ids.forEach(id => api('GET', P + '/reports/' + id).then(r => {
    reps[id] = { ...reps[id], rep: r, live: r.status === 'running' };
    subs.forEach(f => f());
  }).catch(() => {}));
}
function watch(id) {
  if (!id) return;
  if (!reps[id]) { reps[id] = { rep: null, live: true }; poll(); }
  else if (!reps[id].rep) reps[id].live = true;
  if (!polling) polling = setInterval(poll, 2000);
}
function useReport(id) {
  const [, tick] = useState(0);
  useEffect(() => {
    if (!id) return undefined;
    const f = () => tick(t => t + 1);
    subs.add(f);
    watch(id);
    if (reps[id] && reps[id].rep && !reps[id].live) f();
    return () => { subs.delete(f); };
  }, [id]);
  return id && reps[id] ? reps[id].rep : null;
}

const markers = rep => (rep ? rep.found : []).filter(f => f.lat != null || f.north != null).map(f => ({
  type: 'marker', id: 'f' + f.n, color: COLOR[f.label] || '#3fb950',
  ...(f.lat != null ? { lat: f.lat, lon: f.lon } : { north: f.north, east: f.east }),
  label: f.label + ' ' + Math.round(f.score * 100) + '% · ' + clock(f.time),
}));

// -- Planner -------------------------------------------------------------------------------
function Planner({ ctx }) {
  const [, tick] = useState(0);
  const pts = plans[ctx.drone] || [];
  const set = p => { plans[ctx.drone] = p; tick(t => t + 1); };
  const [adding, setAdding] = useState(false);
  const [look, setLook] = useState(30);
  const [alt, setAlt] = useState(50);
  const [looks, setLooks] = useState(4);
  const [secs, setSecs] = useState(6);
  useEffect(() => {
    ctx.map.draw(pts.length ? [{ type: 'route', id: 'search', points: pts, editable: true, kind: 'draft', closed: false }] : [], {
      onShape: (sh, ev) => { if (ev.kind === 'edit') set(ev.points); },
      onClick: adding ? p => set([...(plans[ctx.drone] || []), [Math.round(p.north), Math.round(p.east)]]) : undefined,
      clickHint: 'Click the map where ' + ctx.drone + ' should look (' + pts.length + ' so far). Pick open ground: it drops to ' + look + ' m there.',
    });
  }, [JSON.stringify(pts), adding, ctx.drone, look]);
  // rough time: transit legs at 5 m/s, down/up 2 x 20 m at ~2 m/s, each look ~(turn 4 s + wait)
  let legs = 0, at = [0, 0];
  pts.forEach(p => { legs += Math.hypot(p[0] - at[0], p[1] - at[1]); at = p; });
  legs += Math.hypot(at[0], at[1]);
  const min = Math.max(1, Math.round((legs / 5 + pts.length * (2 * (alt - look) / 2 + looks * (secs + 4)) + 30) / 60));
  const start = () => ctx.run('Search', () => api('POST', '/drones/' + ctx.drone + '/job', {
    plugin: 'search', args: { points: pts, look_altitude: look, altitude: alt, looks, look_seconds: secs },
  }).then(j => { setAdding(false); return { message: 'started' + (j.text ? ': ' + j.text : '') }; }));
  return h('div', { className: 'mn-block' },
    h('div', { className: 'mn-title' }, 'Look points', h('span', { className: 'cc-sub' }, pts.length ? String(pts.length) : 'none yet')),
    h('div', { className: 'cc-buttons' },
      h('button', { className: adding ? 'armed' : '', onClick: () => setAdding(!adding), disabled: !ctx.home }, adding ? 'Done adding' : pts.length ? 'Add points' : 'Pick on map'),
      h('button', { onClick: () => set(pts.slice(0, -1)), disabled: !pts.length }, 'Undo'),
      h('button', { onClick: () => { set([]); setAdding(false); }, disabled: !pts.length }, 'Clear')),
    h('div', { className: 'cc-hint' }, 'It flies between points at the safe height, drops straight down at each one, turns to look around, and reports every person or vehicle it confirms.'),
    row('Look from', num(look, setLook, 20, 45), ' m', h('label', { style: { minWidth: 0, marginLeft: 8 } }, 'fly at'), num(alt, setAlt, 45, 120), ' m'),
    row('Turns', num(looks, setLooks, 1, 8), ' × ', num(secs, setSecs, 3, 30), ' s'),
    h('button', { className: 'go wide', onClick: start, disabled: ctx.busy || !pts.length || look >= alt },
      'Start search' + (pts.length ? ' · ~' + min + ' min' : '')));
}

// -- what it found ---------------------------------------------------------------------------
function Thumb({ rid, f, big, onClick }) {
  const [src, setSrc] = useState('');
  useEffect(() => {
    let on = true;
    // f.photo: the photo's number (older reports: true = same number as the find)
    if (f.photo) blobUrl(P + '/reports/' + rid + '/photos/' + (f.photo === true ? f.n : f.photo) + '.jpg').then(u => on && setSrc(u)).catch(() => {});
    return () => { on = false; };
  }, [rid, f.n, f.photo]);
  const b = f.box || [];
  const box = b.length === 4 ? h('div', { style: { position: 'absolute', left: b[0] * 100 + '%', top: b[1] * 100 + '%',
    width: (b[2] - b[0]) * 100 + '%', height: (b[3] - b[1]) * 100 + '%', border: '2px solid ' + (COLOR[f.label] || '#3fb950'), boxSizing: 'border-box' } }) : null;
  const cls = big ? 'pr-big' : 'pr-thumb';
  return h('div', { style: { position: 'relative', display: 'inline-block', lineHeight: 0 }, onClick },
    src ? h('img', { src, className: cls, alt: f.label }) : h('div', { className: cls + ' empty' }, f.photo ? '…' : 'no photo'),
    src ? box : null);
}

function Found({ rep }) {
  const [open, setOpen] = useState(null);
  if (!rep) return h('div', { className: 'cc-hint' }, 'Loading…');
  const cur = open != null ? rep.found.find(f => f.n === open) : null;
  if (!rep.found.length) return h('div', { className: 'cc-hint' }, rep.status === 'running' ? 'Nothing confirmed yet.' : 'Nothing found.');
  return h('div', null,
    h('div', { className: 'pr-grid' }, rep.found.map(f => h('div', { key: f.n, className: 'pr-cell' },
      h(Thumb, { rid: rep.id, f, onClick: () => setOpen(f.n) }),
      h('span', null, f.label + ' ' + Math.round(f.score * 100) + '%' + (f.point ? ' · P' + f.point : ''))))),
    cur ? h('div', { className: 'pr-modal', onClick: () => setOpen(null) },
      h('div', { className: 'pr-modal-box', onClick: e => e.stopPropagation() },
        h(Thumb, { rid: rep.id, f: cur, big: true }),
        h('div', { className: 'pr-modal-info' },
          h('b', null, cur.label + ' · ' + Math.round(cur.score * 100) + '%'),
          ' · ' + clock(cur.time) + ' · N ' + cur.north + ' E ' + cur.east + (cur.lat != null ? ' (' + cur.lat.toFixed(6) + ', ' + cur.lon.toFixed(6) + ')' : '') +
          (cur.point ? ' · seen from point ' + cur.point : ''),
          h('span', { className: 'pr-nav' }, h('button', { onClick: () => setOpen(null) }, 'Close'))))) : null);
}

function Live({ ctx }) {
  const id = ctx.job && ctx.job.id;
  const rep = useReport(id);
  const total = rep ? rep.points.length : 0;
  return h('div', { className: 'mn-block' },
    h('div', { className: 'mn-title' }, 'Searching', h('span', { className: 'cc-sub' }, (ctx.job && ctx.job.text) || '')),
    total ? h('div', { className: 'cc-progress' }, h('div', { style: { width: Math.round(100 * rep.visited / total) + '%' } })) : null,
    h('div', { className: 'cc-buttons' }, h('button', { className: 'warn', onClick: ctx.returnHome, disabled: ctx.busy }, 'Stop: return home')),
    h('div', { className: 'mn-title' }, 'Found', h('span', { className: 'cc-sub' }, rep ? String(rep.found.length) : '')),
    h(Found, { rep }));
}

// Reports tab: what one finished search found (status and time are on the job row above it).
function Report({ ctx, job }) {
  const rid = (job.links && job.links.report) || job.id;
  const rep = useReport(rid);
  useEffect(() => {
    if (!rep) return;
    ctx.map.draw([{ type: 'route', points: rep.points, kind: 'active', closed: false }, ...markers(rep)]);
  }, [rep && rep.id, rep && rep.found.length]);
  return h(Found, { rep });
}

// On the map while the drone is on a search job (any tab): its look points and what it found.
function overlay(ctx) {
  const id = ctx.job && ctx.job.id;
  watch(id);
  const rep = id && reps[id] ? reps[id].rep : null;
  const pts = (rep && rep.points) || (ctx.job && ctx.job.args && Array.isArray(ctx.job.args.points) ? ctx.job.args.points : []);
  return [...(pts.length ? [{ type: 'route', points: pts, kind: 'active', closed: false }] : []), ...markers(rep)];
}

function status(ctx) {
  return (ctx.job && ctx.job.text) || 'starting';
}

export default { Planner, Live, Report, overlay, status };
