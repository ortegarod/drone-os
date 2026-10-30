// Dispatch plugin UI, served by the dispatch service (manifest "ui": "/ui/job.js") and loaded
// by the Command Center. Plain ES module; React comes from window.DroneOS.
// Incidents come from the dispatch service through the fleet API proxy (/api/v1/plugins/dispatch/...).
const { React, h, api } = window.DroneOS;
const { useState, useEffect } = React;

// One poll shared by every screen (and by overlay(), which must not use hooks).
let incidents = [];
const subs = new Set();
let timer = null;
const poll = () => api('GET', '/plugins/dispatch/api/incidents')
  .then(l => { incidents = Array.isArray(l) ? l : []; subs.forEach(f => f()); }).catch(() => {});
function useIncidents() {
  const [, tick] = useState(0);
  useEffect(() => {
    const f = () => tick(t => t + 1);
    subs.add(f);
    if (!timer) { poll(); timer = setInterval(poll, 3000); }
    return () => { subs.delete(f); };
  }, []);
  return incidents;
}
poll();
timer = setInterval(poll, 3000);   // overlay() reads the cache even when no screen is open

const ACTIVE = ['dispatched', 'on_scene', 'returning'];
const words = s => String(s || '').replace(/_/g, ' ');
const clock = iso => { const t = new Date(iso); return isNaN(t.getTime()) ? iso : t.toLocaleTimeString([], { hour12: false }); };
const where = i => (i.location && i.location.name ? i.location.name : i.description) +
  (i.location && i.location.x != null ? ' · N ' + Math.round(i.location.x) + ' E ' + Math.round(i.location.y || 0) + ' m' : '');
const mine = (ctx) => incidents.find(i => ctx.job && i.job === ctx.job.id) || null;
const pin = (i, color) => ({ type: 'marker', north: i.location.x, east: i.location.y || 0, color,
  label: 'P' + i.priority + ' ' + words(i.type) + ' (' + i.id + ')' });

function Planner({ ctx }) {
  const open = useIncidents().filter(i => i.status === 'new' && i.location && i.location.x != null)
    .sort((a, b) => a.priority - b.priority);
  useEffect(() => { ctx.map.draw(open.map(i => pin(i, i.priority === 1 ? '#f85149' : '#d29922'))); },
    [open.map(i => i.id).join(',')]);
  const send = i => ctx.run('Send ' + ctx.drone, () =>
    ctx.api('POST', '/drones/' + ctx.drone + '/job', { plugin: 'dispatch', args: { incident_id: i.id } })
      .then(j => ({ message: j.text || 'on its way' })));
  return h('div', { className: 'mn-block' },
    h('div', { className: 'mn-title' }, 'Open incidents', h('span', { className: 'cc-sub' }, String(open.length))),
    open.length ? null : h('div', { className: 'cc-hint' }, 'None right now. When the dispatch service raises one, the AI dispatcher sends the closest free drone; you can also send this one from here.'),
    open.slice(0, 6).map(i => h('div', { key: i.id, className: 'cc-incident' },
      h('div', null, h('b', null, 'P' + i.priority + ' ' + words(i.type)), ' ', h('span', { className: 'cc-sub' }, clock(i.created_at))),
      h('div', { className: 'cc-hint' }, where(i)),
      h('button', { onClick: () => send(i), disabled: ctx.busy }, 'Send ' + ctx.drone + ' (50 m)'))));
}

function Live({ ctx }) {
  useIncidents();
  const i = mine(ctx);
  if (!i) return h('div', { className: 'mn-block' }, h('div', { className: 'cc-hint' }, (ctx.job && ctx.job.text) || 'Dispatch job'));
  const resolve = () => ctx.run('Resolve', () => ctx.api('POST', '/plugins/dispatch/api/dispatch/resolve/' + i.id)
    .then(r => { if (!r.ok) throw new Error(r.error || 'failed'); return { message: 'resolved, returning home' }; }));
  return h('div', { className: 'mn-block' },
    h('div', { className: 'mn-title' }, 'P' + i.priority + ' ' + words(i.type), h('span', { className: 'cc-sub' }, words(i.status))),
    h('div', { className: 'cc-hint' }, where(i)),
    h('div', { className: 'cc-hint' }, i.description),
    h('div', { className: 'cc-buttons' }, h('button', { className: 'warn', onClick: resolve, disabled: ctx.busy }, 'Resolved: return home')));
}

// Reports tab: the incident one finished dispatch job went to (result and time are on the job row).
function Report({ job }) {
  useIncidents();
  const id = (job.links && job.links.incident) || (job.args && job.args.incident_id);
  const i = incidents.find(x => x.id === id);
  if (!i) return h('div', { className: 'cc-hint' }, 'Incident ' + (id || '?') + ' (no longer in the dispatch service).');
  return h('div', { className: 'cc-incident' },
    h('div', null, h('b', null, 'P' + i.priority + ' ' + words(i.type)), ' ', h('span', { className: 'cc-sub' }, where(i))),
    i.description ? h('div', { className: 'cc-hint' }, i.description) : null);
}

// While on a dispatch job: the incident it's flying to.
function overlay(ctx) {
  const i = mine(ctx);
  return i && i.location && i.location.x != null ? [pin(i, '#f85149')] : [];
}

export default { Planner, Live, Report, overlay };
