// Fleet sidebar: list of all drones with status pills, stats, and selection.
import React from 'react';
import type { FleetDrone } from '../api/fleet';
import type { Job } from './apps/registry';
import { PatrolStatus, patrolAt, patrolTotal, reasonText, statusOf } from './status';
import { homeOf, distance } from './geo';


interface Props {
  names: string[];
  drones: Record<string, FleetDrone>;
  selected: string;
  onSelect: (name: string) => void;
  patrols: Record<string, PatrolStatus>;
  jobs: Record<string, Job>;
}

const COMPASS = ['N','NE','E','SE','S','SW','W','NW'];
const compass = (deg: number) => COMPASS[Math.round((((deg % 360) + 360) % 360) / 45) % 8];
const fmt = (v: number | null | undefined, d = 0) => (v == null || isNaN(v) ? '–' : v.toFixed(d));

function motion(d?: FleetDrone) {
  const vn = d?.velocity.north || 0, ve = d?.velocity.east || 0, vd = d?.velocity.down || 0;
  const speed = Math.hypot(vn, ve);
  const course = speed > 0.5 ? (Math.atan2(ve, vn) * 180) / Math.PI : null;
  return { speed, course, climb: -vd };
}

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

const FleetList: React.FC<Props> = ({ names, drones, selected, onSelect, patrols, jobs }) => (
  <aside className="cc-fleet">
    <div className="cc-section">Fleet</div>
    {names.map(n => {
      const x = drones[n];
      const s = statusOf(x, patrols[n]);
      const mv = motion(x);
      const h = homeOf(x);
      const fh = x && h && x.gps.lat != null && x.gps.lon != null ? distance(h, { lat: x.gps.lat, lon: x.gps.lon }) : null;
      const air = !!x?.armed;
      return (
        <button key={n} className={`cc-drone ${n === selected ? 'sel' : ''}`} onClick={() => onSelect(n)}>
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
    {!names.length && <div className="cc-empty">No drones reporting</div>}
  </aside>
);

export default FleetList;
export { doing, motion, fmt, compass };
