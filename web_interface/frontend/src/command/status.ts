// One plain-language status per drone, from the fleet API state.
import { FleetDrone } from '../api/fleet';

export interface PatrolStatus {
  loaded: boolean; running: boolean; finished: boolean; item: number; items: number; progress: number;
  failed?: boolean; failure_reason?: string; paused?: boolean;
}

// The onboard mission is the patrol points (x loops) plus a final return-home item.
export const patrolTotal = (p: PatrolStatus) => Math.max(1, (p.items || 1) - 1);
export const patrolAt = (p: PatrolStatus) => Math.min((p.item || 0) + 1, patrolTotal(p));
export const patrolText = (p: PatrolStatus) => `${patrolAt(p)}/${patrolTotal(p)}`;

export type Tone = 'ok' | 'busy' | 'warn' | 'bad' | 'off';

// PX4 failsafe flag names → words an operator understands.
const REASONS: Record<string, string> = {
  geofence_breached: 'left the geofence',
  local_position_invalid: 'no position',
  global_position_invalid: 'no GPS position',
  local_position_accuracy_low: 'position inaccurate',
  local_altitude_invalid: 'no altitude',
  home_position_invalid: 'no home position',
  offboard_control_signal_lost: 'lost its command stream',
  battery_warning: 'battery low',
  battery_low_remaining_time: 'battery: not enough flight time left',
  battery_unhealthy: 'battery fault',
  wind_limit_exceeded: 'too windy',
  flight_time_limit_exceeded: 'flight time limit',
  fd_critical_failure: 'critical failure (tilt/crash)',
  fd_esc_arming_failure: 'ESC failure',
  fd_imbalanced_prop: 'imbalanced prop',
  fd_motor_failure: 'motor failure',
  gcs_connection_lost: 'ground station link lost',
  mission_failure: 'mission failed',
  vtol_fixed_wing_system_failure: 'VTOL failure',
  navigator_failure: 'navigation failure',
  primary_geofence_breached: 'left the geofence',
};
export const reasonText = (r: string) => REASONS[r] || r.replace(/_/g, ' ');

export function statusOf(d: FleetDrone | undefined, patrol?: PatrolStatus | null): { label: string; tone: Tone } {
  if (!d || !d.online) return { label: 'Offline', tone: 'off' };
  const mode = (d.mode || '').toUpperCase();
  const alt = d.position.altitude ?? 0;
  if (d.failsafe) {
    const why = (d.failsafe_reasons || []).map(reasonText)[0];
    return { label: why ? `Failsafe: ${why}` : 'Failsafe', tone: 'bad' };
  }
  if (!d.armed) return alt > 1.5 ? { label: 'Disarmed in air?', tone: 'bad' } : { label: 'Landed', tone: 'ok' };
  if (mode.includes('RTL') || mode.includes('RETURN')) return { label: 'Returning home', tone: 'warn' };
  if (mode.includes('LAND')) return { label: 'Landing', tone: 'warn' };
  if (mode.includes('TAKEOFF') || d.landed_state === 'ON_GROUND') return { label: 'Taking off', tone: 'busy' };
  if (mode.includes('ORBIT')) return { label: 'Orbiting', tone: 'busy' };
  if (patrol?.running) return { label: `Patrol ${patrolText(patrol)}`, tone: 'busy' };
  if (patrol?.paused) return { label: `Patrol paused ${patrolText(patrol)}`, tone: 'warn' };
  if (mode.includes('LOITER') || mode.includes('HOLD')) return { label: 'Holding', tone: 'busy' };
  return { label: 'Flying', tone: 'busy' };
}
