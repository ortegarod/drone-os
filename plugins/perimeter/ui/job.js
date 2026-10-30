// Fence check plugin UI: a plain ES module the command center loads from this plugin
// (manifest "ui": "/ui/job.js"). No build step: React comes from window.DroneOS.
const { React, h, api, blobUrl } = window.DroneOS;
const { useState, useEffect } = React;
const P = '/plugins/perimeter';
const COLOR = { person: '#f85149', car: '#58a6ff', truck: '#58a6ff', bus: '#58a6ff', motorcycle: '#58a6ff' };

const num = (v, set, min, max, step) => h('input', { type: 'number', value: v, min, max, step: step || 1,
  onChange: e => set(Math.max(min, Math.min(max, Number(e.target.value) || min))) });
const row = (label, ...kids) => h('div', { className: 'cc-row' }, h('label', null, label), ...kids);

// Reports by id, one shared poll while a job runs (overlay() can't use hooks).
const reps = {};
const subs = new Set();
let polling = null;
function poll() {
  const ids = Object.keys(reps).filter(id => reps[id].live);
  if (!ids.length) { clearInterval(polling); polling = null; return; }
  ids.forEach(id => api('GET', P + '/reports/' + id).then(r => {
    reps[id] = { rep: r, live: r.status === 'running' };
    subs.forEach(f => f());
  }).catch(() => {}));
}
function watch(id) {
  if (!id) return;
  if (!reps[id]) { reps[id] = { rep: null, live: true }; poll(); }
  if (!polling) polling = setInterval(poll, 2000);
}
function useReport(id) {
  const [, tick] = useState(0);
  useEffect(() => {
    if (!id) return undefined;
    const f = () => tick(t => t + 1);
    subs.add(f);
    watch(id);
    return () => { subs.delete(f); };
  }, [id]);
  return id && reps[id] ? reps[id].rep : null;
}

const markers = rep => (rep ? rep.found : []).map(f => ({
  type: 'marker', id: 'f' + f.n, color: COLOR[f.label] || '#3fb950', north: f.north, east: f.east,
  label: (f.new ? 'NEW ' : '') + f.label }));
const shapes = rep => rep ? [{ type: 'route', id: 'fence-check', points: rep.route, kind: 'active', closed: true }, ...markers(rep)] : [];

function Photo({ rid, n, big }) {
  const [src, setSrc] = useState('');
  useEffect(() => {
    let on = true;
    blobUrl(P + '/reports/' + rid + '/photos/' + n + '.jpg').then(u => on && setSrc(u)).catch(() => {});
    return () => { on = false; };
  }, [rid, n]);
  const cls = big ? 'pr-big' : 'pr-thumb';
  return src ? h('img', { src, className: cls }) : h('div', { className: cls + ' empty' }, '…');
}

function Found({ rep }) {
  if (!rep) return h('div', { className: 'cc-hint' }, 'Loading…');
  const found = rep.found || [];
  const head = !rep.compared ? 'First check: everything it sees is the baseline for next time.'
    : found.filter(f => f.new).length + ' new since the last check, ' + found.length + ' seen in all.';
  return h('div', null,
    h('div', { className: 'cc-hint' }, head),
    found.length ? h('div', { className: 'pr-grid' }, found.map(f => h('div', { key: f.n, className: 'pr-cell' },
      f.photo ? h(Photo, { rid: rep.id, n: f.photo }) : h('div', { className: 'pr-thumb empty' }, 'no photo'),
      h('span', null, (f.new ? 'NEW · ' : '') + f.label + ' · N ' + Math.round(f.north) + ' E ' + Math.round(f.east))))) : null,
    h('div', { className: 'mn-title' }, 'Fence line', h('span', { className: 'cc-sub' }, (rep.photos || []).filter(p => p.stop).length + ' photos')),
    h('div', { className: 'pr-grid' }, (rep.photos || []).filter(p => p.stop).map(p => h(Photo, { key: p.n, rid: rep.id, n: p.n }))));
}

function Planner({ ctx }) {
  const [alt, setAlt] = useState(50);
  const [inset, setInset] = useState(10);
  const [spacing, setSpacing] = useState(50);
  useEffect(() => { ctx.map.draw([]); }, []);
  const start = () => ctx.run('Fence check', () => api('POST', '/drones/' + ctx.drone + '/job', {
    plugin: 'perimeter', args: { altitude: alt, inset, spacing },
  }).then(j => ({ message: 'started' + (j.text ? ': ' + j.text : '') })));
  return h('div', { className: 'mn-block' },
    h('div', { className: 'mn-title' }, 'Fence check'),
    h('div', { className: 'cc-hint' }, 'Flies just inside the property fence (Dev tab), photographs it looking out, and reports people and vehicles. Anything that wasn\'t there on the last check is marked NEW.'),
    row('Altitude', num(alt, setAlt, 45, 120), ' m'),
    row('Inside the fence by', num(inset, setInset, 3, 50), ' m'),
    row('Photo every', num(spacing, setSpacing, 20, 200, 10), ' m'),
    h('button', { className: 'go wide', onClick: start, disabled: ctx.busy || !ctx.home }, 'Start fence check'));
}

function Live({ ctx }) {
  const rep = useReport(ctx.job && ctx.job.id);
  const total = rep ? rep.route.length + 1 : 0;
  return h('div', { className: 'mn-block' },
    h('div', { className: 'mn-title' }, 'Checking the fence', h('span', { className: 'cc-sub' }, (ctx.job && ctx.job.text) || '')),
    total ? h('div', { className: 'cc-progress' }, h('div', { style: { width: Math.round(100 * rep.visited / total) + '%' } })) : null,
    h('div', { className: 'cc-buttons' }, h('button', { className: 'warn', onClick: ctx.returnHome, disabled: ctx.busy }, 'Stop: return home')),
    h(Found, { rep }));
}

function Report({ ctx, job }) {
  const rep = useReport((job.links && job.links.report) || job.id);
  useEffect(() => { if (rep) ctx.map.draw(shapes(rep)); }, [rep && rep.id, rep && rep.found.length]);
  return h(Found, { rep });
}

function overlay(ctx) {
  const id = ctx.job && ctx.job.id;
  watch(id);
  return shapes(id && reps[id] ? reps[id].rep : null);
}

const status = ctx => (ctx.job && ctx.job.text) || 'starting';

export default { Planner, Live, Report, overlay, status };
