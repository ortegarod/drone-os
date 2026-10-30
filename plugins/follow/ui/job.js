// Follow plugin UI: a plain ES module the command center loads from this plugin
// (manifest "ui": "/ui/job.js"). No build step: React comes from window.DroneOS.
// Default export: { Planner, Live, Report, overlay, status }.
const { React, h, api, blobUrl } = window.DroneOS;
const { useState, useEffect } = React;
const P = '/plugins/follow';
const clock = t => (t ? t.slice(11, 19) : '');
const num = (v, set, min, max, step) => h('input', { type: 'number', value: v, min, max, step: step || 1,
  onChange: e => set(Math.max(min, Math.min(max, Number(e.target.value) || min))) });
const row = (label, ...kids) => h('div', { className: 'cc-row' }, h('label', null, label), ...kids);

// Report of the running job, one shared poll (overlay() can't use hooks).
let cur = { id: null, rep: null, timer: null };
const subs = new Set();
function watch(id) {
  if (cur.id === id) return;
  clearInterval(cur.timer);
  cur = { id, rep: null, timer: null };
  if (!id) return;
  const load = () => api('GET', P + '/reports/' + id).then(r => { if (cur.id === id) { cur.rep = r; subs.forEach(f => f()); } }).catch(() => {});
  load();
  cur.timer = setInterval(load, 2000);
}
function useReport(id, live) {
  const [rep, setRep] = useState(null);
  useEffect(() => {
    if (!id) return undefined;
    if (live) {
      watch(id);
      const f = () => setRep(cur.rep);
      subs.add(f); f();
      return () => { subs.delete(f); };
    }
    let on = true;
    api('GET', P + '/reports/' + id).then(r => on && setRep(r)).catch(() => {});
    return () => { on = false; };
  }, [id, live]);
  return rep;
}

const pathShape = rep => (rep && rep.path.length > 1
  ? [{ type: 'line', points: rep.path, color: '#f85149', dashed: true, label: 'where they walked' }] : []);

function Planner({ ctx }) {
  const [pt, setPt] = useState(null);
  const [alt, setAlt] = useState(30);
  const [minutes, setMinutes] = useState(5);
  // people this drone sees right now (confirmed, on the ground)
  const seen = ((ctx.d && ctx.d.detections && ctx.d.detections.tracks) || []).filter(t => t.label === 'person' && t.ground);
  useEffect(() => {
    ctx.map.draw(pt ? [{ type: 'marker', north: pt.north, east: pt.east, color: '#f85149', label: 'follow the person here' }] : []);
  }, [pt && pt.north, pt && pt.east]);
  const pick = async () => { const p = await ctx.map.pick('Click where the person is: the drone locks on to the person it sees nearest that spot'); if (p) setPt(p); };
  const start = () => ctx.run('Follow', () => api('POST', '/drones/' + ctx.drone + '/job', {
    plugin: 'follow', args: { north: Math.round(pt.north * 10) / 10, east: Math.round(pt.east * 10) / 10, altitude: alt, minutes },
  }).then(j => ({ message: j.text || 'started' })));
  return h('div', { className: 'mn-block' },
    h('div', { className: 'mn-title' }, 'Who', h('span', { className: 'cc-sub' }, pt ? 'person near N ' + pt.north.toFixed(0) + ' E ' + pt.east.toFixed(0) : 'not picked yet')),
    h('div', { className: 'cc-buttons' },
      ...seen.slice(0, 3).map(t => h('button', { key: t.id, onClick: () => setPt(t.ground) }, 'Person at N ' + t.ground.north.toFixed(0) + ' E ' + t.ground.east.toFixed(0))),
      h('button', { onClick: pick, disabled: !ctx.home }, seen.length ? 'Pick on map' : pt ? 'Pick again' : 'Pick on map')),
    h('div', { className: 'cc-hint' }, 'The drone stays as far from them as it is high, camera on them, and goes home if it loses them for 30 s.'),
    row('Height', num(alt, setAlt, 20, 60), ' m', alt < 45 ? h('span', { className: 'cc-warnline' }, 'open ground only, trees ~40 m') : null),
    row('Minutes', num(minutes, setMinutes, 0.5, 30, 0.5)),
    h('button', { className: 'go wide', onClick: start, disabled: ctx.busy || !pt }, 'Start following'));
}

function Photos({ rep }) {
  const [open, setOpen] = useState(null);
  if (!rep || !rep.photos.length) return null;
  const sel = open != null ? rep.photos.find(p => p.n === open) : null;
  return h('div', null,
    h('div', { className: 'pr-grid' }, rep.photos.slice(-6).map(p => h('div', { key: p.n, className: 'pr-cell' },
      h(Img, { rid: rep.id, n: p.n, onClick: () => setOpen(p.n) }), h('span', null, clock(p.time))))),
    sel ? h('div', { className: 'pr-modal', onClick: () => setOpen(null) },
      h('div', { className: 'pr-modal-box', onClick: e => e.stopPropagation() },
        h(Img, { rid: rep.id, n: sel.n, big: true }),
        h('div', { className: 'pr-modal-info' }, h('b', null, clock(sel.time)), ' · person at N ' + sel.north + ' E ' + sel.east,
          h('span', { className: 'pr-nav' }, h('button', { onClick: () => setOpen(null) }, 'Close'))))) : null);
}

function Img({ rid, n, big, onClick }) {
  const [src, setSrc] = useState('');
  useEffect(() => { let on = true; blobUrl(P + '/reports/' + rid + '/photos/' + n + '.jpg').then(u => on && setSrc(u)).catch(() => {}); return () => { on = false; }; }, [rid, n]);
  const cls = big ? 'pr-big' : 'pr-thumb';
  return src ? h('img', { src, className: cls, onClick }) : h('div', { className: cls + ' empty' }, '…');
}

function Live({ ctx }) {
  const rep = useReport(ctx.job && ctx.job.id, true);
  return h('div', { className: 'mn-block' },
    h('div', { className: 'mn-title' }, 'Following', h('span', { className: 'cc-sub' }, (ctx.job && ctx.job.text) || '')),
    rep ? h('div', { className: 'cc-hint' }, 'Person walked ' + Math.round(rep.walked_m) + ' m · lost ' + rep.lost_count + 'x') : null,
    h('div', { className: 'cc-buttons' }, h('button', { className: 'warn', onClick: ctx.returnHome, disabled: ctx.busy }, 'Stop: return home')),
    h(Photos, { rep }));
}

// Reports tab: one finished follow (result and time are on the job row above it).
function Report({ ctx, job }) {
  const rep = useReport((job.links && job.links.report) || job.id, false);
  useEffect(() => { if (rep) ctx.map.draw(pathShape(rep)); }, [rep && rep.id]);
  if (!rep) return h('div', { className: 'cc-hint' }, 'Loading…');
  // the numbers are in the job's summary just above; here only the photos (the path is on the map)
  return h(Photos, { rep });
}

// While on the job (any tab): where the person walked.
function overlay(ctx) {
  watch(ctx.job && ctx.job.id);
  return pathShape(cur.rep);
}

function status(ctx) {
  return (ctx.job && ctx.job.text) || 'starting';
}

export default { Planner, Live, Report, overlay, status };
