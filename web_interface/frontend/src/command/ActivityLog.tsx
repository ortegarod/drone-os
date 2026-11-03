// Activity log footer: collapsing repeated commands into a count.
import React from 'react';

export interface LogEntry {
  time: string;
  operator: string;
  drone?: string;
  command: string;
  args?: Record<string, any>;
  ok: boolean;
  message?: string;
}

const fmt = (v: number | null | undefined, d = 0) => (v == null || isNaN(v) ? '–' : v.toFixed(d));
const clock = (iso: string) => { const t = new Date(iso); return isNaN(t.getTime()) ? iso : t.toLocaleTimeString([], { hour12: false }); };

function describe(e: LogEntry): string {
  const a = e.args || {};
  switch (e.command) {
    case 'takeoff':       return `take off to ${a.altitude ?? '?'} m`;
    case 'goto':          return `go to N${fmt(a.north)} E${fmt(a.east)}${a.altitude != null ? ` at ${a.altitude} m` : ''}`;
    case 'patrol':        return `patrol ${(a.route || []).length} points × ${a.loops ?? 1} at ${a.altitude ?? '?'} m`;
    case 'return_home':   return 'return home';
    case 'hold':          return 'hold position';
    case 'orbit':         return `orbit N${fmt(a.north)} E${fmt(a.east)}, r ${a.radius ?? '?'} m at ${a.speed ?? '?'} m/s`;
    case 'route':         return (a.points || []).length ? `set route: ${(a.points || []).length} points` : 'clear route';
    case 'job_start':     return `start ${a.plugin || ''} job`;
    case 'job_end':       return `${a.plugin || ''} job ended`;
    case 'take_control':  return 'take control';
    case 'release_control': return 'release control';
    default:              return e.command.replace('_', ' ');
  }
}

function collapse(log: LogEntry[]): Array<{ e: LogEntry; n: number }> {
  const out: Array<{ e: LogEntry; n: number }> = [];
  for (const e of log) {
    const last = out[out.length - 1];
    if (last && last.e.operator === e.operator && last.e.drone === e.drone && last.e.ok === e.ok && last.e.command === e.command) last.n += 1;
    else out.push({ e, n: 1 });
  }
  return out;
}

interface Props { log: LogEntry[] }

const ActivityLog: React.FC<Props> = ({ log }) => (
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
);

export default ActivityLog;
export { describe, collapse, clock, fmt as logFmt };
