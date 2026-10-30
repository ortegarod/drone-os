// Inspect plugin UI: a plain ES module the command center loads from this plugin
// (manifest "ui": "/ui/job.js"). No build step: React comes from window.DroneOS.
// Default export: { Planner, Live, Report, overlay }: components get { ctx };
// overlay(ctx) returns what to draw on the map while the drone is on this job.
const { React, h } = window.DroneOS;
const { useState, useEffect } = React;

const num = (v, set, min, max, step) => h('input', {
  type: 'number', value: v, min, max, step: step || 1,
  onChange: e => set(Math.max(min, Math.min(max, Number(e.target.value) || min))),
});
const row = (label, ...kids) => h('div', { className: 'cc-row' }, h('label', null, label), ...kids);

function Planner({ ctx }) {
  const [pt, setPt] = useState(null);
  const [radius, setRadius] = useState(25);
  const [speed, setSpeed] = useState(3);
  const [alt, setAlt] = useState(50);
  const [minutes, setMinutes] = useState(1);
  const [every, setEvery] = useState(10);
  // Preview the circle on the map while planning.
  useEffect(() => {
    ctx.map.draw(pt ? [{ type: 'circle', north: pt.north, east: pt.east, radius, color: '#d29922', label: 'inspect here' }] : []);
  }, [pt && pt.north, pt && pt.east, radius]);
  const pick = async () => { const p = await ctx.map.pick('Click the point to inspect: the drone circles it with the camera on it'); if (p) setPt(p); };
  const start = () => ctx.run('Inspect', () => ctx.api('POST', '/drones/' + ctx.drone + '/job', {
    plugin: 'inspect', args: { north: pt.north, east: pt.east, radius, speed, altitude: alt, minutes, photo_every: every },
  }).then(j => ({ message: j.text || 'started' })));
  return h('div', { className: 'mn-block' },
    h('div', { className: 'mn-title' }, 'Point', h('span', { className: 'cc-sub' }, pt ? 'N ' + pt.north.toFixed(0) + ' E ' + pt.east.toFixed(0) + ' m' : 'not picked yet')),
    h('div', { className: 'cc-buttons' }, h('button', { onClick: pick, disabled: !ctx.home }, pt ? 'Pick again' : 'Pick on map')),
    row('Radius', num(radius, setRadius, 5, 100), ' m'),
    row('Speed', num(speed, setSpeed, 1, 8, 0.5), ' m/s'),
    row('Altitude', num(alt, setAlt, 45, 120), ' m'),
    row('Minutes', num(minutes, setMinutes, 0.2, 30, 0.5), ' photo every ', num(every, setEvery, 3, 120), ' s'),
    h('button', { className: 'go wide', onClick: start, disabled: ctx.busy || !pt }, 'Start inspection'),
    h('div', { className: 'cc-hint' }, 'Example plugin (plugins/inspect): its UI is this file, served by the plugin itself.'));
}

function useReports(ctx, limit) {
  const [list, setList] = useState([]);
  useEffect(() => {
    let alive = true;
    const load = () => ctx.api('GET', '/plugins/inspect/reports?drone=' + ctx.drone + '&limit=' + limit).then(l => alive && setList(l)).catch(() => {});
    load();
    const t = setInterval(load, 3000);
    return () => { alive = false; clearInterval(t); };
  }, [ctx.drone]);
  return list;
}

function Photo({ ctx, rid, n }) {
  const [src, setSrc] = useState('');
  useEffect(() => {
    let alive = true;
    fetch('/api/v1/plugins/inspect/reports/' + rid + '/photos/' + n + '.jpg', { headers: { Authorization: 'Bearer ' + localStorage.getItem('droneos_operator_key') } })
      .then(r => r.blob()).then(b => alive && setSrc(URL.createObjectURL(b))).catch(() => {});
    return () => { alive = false; };
  }, [rid, n]);
  return src ? h('img', { src, className: 'pr-thumb' }) : h('div', { className: 'pr-thumb empty' }, '…');
}

function Live({ ctx }) {
  const rep = useReports(ctx, 1).find(r => r.id === (ctx.job && ctx.job.id));
  const shots = rep ? rep.photos : [];
  return h('div', { className: 'mn-block' },
    h('div', { className: 'mn-title' }, 'Inspecting', h('span', { className: 'cc-sub' }, (ctx.job && ctx.job.text) || '')),
    h('div', { className: 'cc-hint' }, shots.length + ' photos so far. Land, Return home or taking control ends it.'),
    h('div', { className: 'pr-grid' }, shots.slice(-6).map(p => h(Photo, { key: p.n, ctx, rid: rep.id, n: p.n }))));
}

// Reports tab: the photos of one finished inspection (status and time are on the job row above it).
function Report({ ctx, job }) {
  const rid = (job.links && job.links.report) || job.id;
  const rep = useReports(ctx, 20).find(r => r.id === rid);
  if (!rep) return h('div', { className: 'cc-hint' }, 'No photos saved for this inspection.');
  return rep.photos.length ? h('div', { className: 'pr-grid' }, rep.photos.map(p => h(Photo, { key: p.n, ctx, rid: rep.id, n: p.n })))
    : h('div', { className: 'cc-hint' }, 'No photos.');
}

// While the job runs (any tab): the circle being flown, from the job's own args.
function overlay(ctx) {
  const a = (ctx.job && ctx.job.args) || {};
  return a.north == null ? [] : [{ type: 'circle', north: a.north, east: a.east, radius: a.radius || 20, label: 'inspecting' }];
}

export default { Planner, Live, Report, overlay };
