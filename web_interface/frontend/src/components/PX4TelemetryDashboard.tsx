import React, { useState, useEffect, useRef } from 'react';
// @ts-ignore
import ROSLIB from 'roslib';

interface PX4TelemetryProps {
  droneAPI: any;
  droneName?: string;
}

interface VehicleStatus {
  timestamp: number;
  arming_state: number;
  nav_state: number;
  nav_state_timestamp: number;
  arming_state_timestamp: number;
  failsafe: boolean;
  failsafe_and_user_took_over: boolean;
  gcs_connection_lost: boolean;
  gcs_connection_lost_counter: number;
  high_latency_data_link_lost: boolean;
  is_vtol: boolean;
  is_vtol_tailsitter: boolean;
  in_transition_mode: boolean;
  in_transition_to_fw: boolean;
  system_type: number;
  system_id: number;
  component_id: number;
  vehicle_type: number;
  flight_uuid: number;
}

interface VehicleLocalPosition {
  timestamp: number;
  timestamp_sample: number;
  ref_timestamp: number;
  ref_lat: number;
  ref_lon: number;
  ref_alt: number;
  xy_valid: boolean;
  z_valid: boolean;
  v_xy_valid: boolean;
  v_z_valid: boolean;
  x: number;
  y: number;
  z: number;
  delta_xy: number[];
  xy_reset_counter: number;
  delta_z: number;
  z_reset_counter: number;
  vx: number;
  vy: number;
  vz: number;
  z_deriv: number;
  delta_vxy: number[];
  vxy_reset_counter: number;
  delta_vz: number;
  vz_reset_counter: number;
  ax: number;
  ay: number;
  az: number;
  heading: number;
  delta_heading: number;
  heading_reset_counter: number;
  heading_good_for_control: boolean;
  xy_global: boolean;
  z_global: boolean;
  origin_init_done: boolean;
}

interface BatteryStatus {
  timestamp: number;
  connected: boolean;
  voltage_v: number;
  voltage_filtered_v: number;
  current_a: number;
  current_filtered_a: number;
  current_average_a: number;
  discharged_mah: number;
  remaining: number;
  scale: number;
  time_remaining_s: number;
  temperature: number;
  cell_count: number;
  source: number;
  priority: number;
  capacity: number;
  cycle_count: number;
  average_time_to_empty: number;
  serial_number: number;
  manufacture_date: number;
  state_of_health: number;
  max_error: number;
  id: number;
  interface_error: number;
  voltage_cell_v: number[];
  max_cell_voltage_delta: number;
  is_powering_off: boolean;
  is_required: boolean;
  faults: number;
  custom_faults: number;
  warning: number;
  mode: number;
  average_power: number;
  available_energy: number;
  full_charge_capacity_wh: number;
  remaining_capacity_wh: number;
  design_capacity: number;
  average_time_to_full: number;
  over_discharge_count: number;
  nominal_voltage: number;
}

interface FailsafeFlags {
  timestamp: number;
  mode_req_angular_velocity: number;
  mode_req_attitude: number;
  mode_req_local_alt: number;
  mode_req_local_position: number;
  mode_req_local_position_relaxed: number;
  mode_req_global_position: number;
  mode_req_mission: number;
  mode_req_offboard_signal: number;
  mode_req_home_position: number;
  mode_req_wind_and_flight_time_compliance: number;
  mode_req_prevent_arming: number;
  mode_req_manual_control: number;
  mode_req_other: number;
  angular_velocity_invalid: boolean;
  attitude_invalid: boolean;
  local_altitude_invalid: boolean;
  local_position_invalid: boolean;
  local_position_invalid_relaxed: boolean;
  local_velocity_invalid: boolean;
  global_position_invalid: boolean;
  auto_mission_missing: boolean;
  offboard_control_signal_lost: boolean;
  home_position_invalid: boolean;
  manual_control_signal_lost: boolean;
  gcs_connection_lost: boolean;
  battery_warning: number;
  battery_low_remaining_time: boolean;
  battery_unhealthy: boolean;
  geofence_breached: boolean;
  mission_failure: boolean;
  vtol_fixed_wing_system_failure: boolean;
  wind_limit_exceeded: boolean;
  flight_time_limit_exceeded: boolean;
  local_position_accuracy_low: boolean;
  fd_critical_failure: boolean;
  fd_esc_arming_failure: boolean;
  fd_imbalanced_prop: boolean;
  fd_motor_failure: boolean;
}

const PX4TelemetryDashboard: React.FC<PX4TelemetryProps> = ({ droneAPI, droneName = 'px4_1' }) => {
  const [vehicleStatus, setVehicleStatus] = useState<VehicleStatus | null>(null);
  const [localPosition, setLocalPosition] = useState<VehicleLocalPosition | null>(null);
  const [batteryStatus, setBatteryStatus] = useState<BatteryStatus | null>(null);
  const [failsafeFlags, setFailsafeFlags] = useState<FailsafeFlags | null>(null);
  const [lastUpdate, setLastUpdate] = useState<number>(0);
  
  const subscriptionsRef = useRef<any[]>([]);

  // Navigation state mappings
  const getNavStateName = (navState: number): string => {
    const states: { [key: number]: string } = {
      0: 'MANUAL',
      1: 'ALTCTL',
      2: 'POSCTL', 
      3: 'AUTO_MISSION',
      4: 'AUTO_LOITER',
      5: 'AUTO_RTL',
      6: 'AUTO_ACRO_OLD',
      7: 'AUTO_OFFBOARD',
      8: 'STAB',
      9: 'RATTITUDE',
      10: 'AUTO_TAKEOFF',
      11: 'AUTO_LAND',
      12: 'AUTO_FOLLOW_TARGET',
      13: 'AUTO_PRECLAND',
      14: 'ORBIT',
      15: 'AUTO_VTOL_TAKEOFF',
      16: 'AUTO_VTOL_LAND',
      17: 'AUTO_READY',
      18: 'AUTO_RTGS'
    };
    return states[navState] || `UNKNOWN(${navState})`;
  };

  // Arming state mappings
  const getArmingStateName = (armingState: number): string => {
    const states: { [key: number]: string } = {
      1: 'INIT',
      2: 'STANDBY',
      3: 'ARMED',
      4: 'STANDBY_ERROR',
      5: 'SHUTDOWN',
      6: 'IN_AIR_RESTORE'
    };
    return states[armingState] || `UNKNOWN(${armingState})`;
  };

  // Battery warning mappings
  const getBatteryWarningName = (warning: number): string => {
    const warnings: { [key: number]: string } = {
      0: 'NONE',
      1: 'LOW',
      2: 'CRITICAL', 
      3: 'EMERGENCY',
      4: 'FAILED',
      6: 'UNHEALTHY',
      7: 'CHARGING'
    };
    return warnings[warning] || `UNKNOWN(${warning})`;
  };

  useEffect(() => {
    if (!droneAPI?.ros) return;

    const ros = droneAPI.ros;
    const subscriptions: any[] = [];

    // Subscribe to vehicle status
    const vehicleStatusTopic = new (ROSLIB as any).Topic({
      ros: ros,
      name: `/${droneName}/fmuout/vehicle_status`,
      messageType: 'px4_msgs/msg/VehicleStatus'
    });
    vehicleStatusTopic.subscribe((message: any) => {
      setVehicleStatus(message);
      setLastUpdate(Date.now());
    });
    subscriptions.push(vehicleStatusTopic);

    // Subscribe to local position
    const localPositionTopic = new (ROSLIB as any).Topic({
      ros: ros,
      name: `/${droneName}/fmuout/vehicle_local_position`,
      messageType: 'px4_msgs/msg/VehicleLocalPosition'
    });
    localPositionTopic.subscribe((message: any) => {
      setLocalPosition(message);
      setLastUpdate(Date.now());
    });
    subscriptions.push(localPositionTopic);

    // Subscribe to battery status
    const batteryStatusTopic = new (ROSLIB as any).Topic({
      ros: ros,
      name: `/${droneName}/fmuout/battery_status`,
      messageType: 'px4_msgs/msg/BatteryStatus'
    });
    batteryStatusTopic.subscribe((message: any) => {
      setBatteryStatus(message);
      setLastUpdate(Date.now());
    });
    subscriptions.push(batteryStatusTopic);

    // Subscribe to failsafe flags
    const failsafeFlagsTopic = new (ROSLIB as any).Topic({
      ros: ros,
      name: `/${droneName}/fmuout/failsafe_flags`, 
      messageType: 'px4_msgs/msg/FailsafeFlags'
    });
    failsafeFlagsTopic.subscribe((message: any) => {
      setFailsafeFlags(message);
      setLastUpdate(Date.now());
    });
    subscriptions.push(failsafeFlagsTopic);

    subscriptionsRef.current = subscriptions;

    return () => {
      subscriptions.forEach(topic => topic.unsubscribe());
    };
  }, [droneAPI?.ros, droneName]);

  const formatTimestamp = (timestamp: number): string => {
    // Convert microseconds to milliseconds and format
    const date = new Date(timestamp / 1000);
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  };

  const getActiveFailsafes = (): string[] => {
    if (!failsafeFlags) return [];
    
    const active: string[] = [];
    if (failsafeFlags.manual_control_signal_lost) active.push('RC Signal Lost');
    if (failsafeFlags.gcs_connection_lost) active.push('GCS Connection Lost');
    if (failsafeFlags.offboard_control_signal_lost) active.push('Offboard Signal Lost');
    if (failsafeFlags.geofence_breached) active.push('Geofence Breached');
    if (failsafeFlags.battery_unhealthy) active.push('Battery Unhealthy');
    if (failsafeFlags.battery_low_remaining_time) active.push('Low Battery Time');
    if (failsafeFlags.wind_limit_exceeded) active.push('Wind Limit Exceeded');
    if (failsafeFlags.flight_time_limit_exceeded) active.push('Flight Time Limit');
    if (failsafeFlags.fd_critical_failure) active.push('Critical Failure');
    if (failsafeFlags.fd_motor_failure) active.push('Motor Failure');
    if (failsafeFlags.fd_imbalanced_prop) active.push('Imbalanced Prop');
    if (failsafeFlags.fd_esc_arming_failure) active.push('ESC Arming Failure');
    if (failsafeFlags.attitude_invalid) active.push('Attitude Invalid');
    if (failsafeFlags.local_position_invalid) active.push('Position Invalid');
    if (failsafeFlags.global_position_invalid) active.push('GPS Invalid');
    
    return active;
  };

  const batteryColor = batteryStatus ? 
    batteryStatus.remaining > 0.5 ? '#00ff88' : 
    batteryStatus.remaining > 0.25 ? '#ff8800' : '#ff4444' : '#888';

  const connectionAge = Date.now() - lastUpdate;
  const isStale = connectionAge > 5000; // 5 seconds

  return (
    <div style={{ padding: '1rem', backgroundColor: '#1a1a1a', borderRadius: '8px', margin: '1rem 0' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
        <h3 style={{ color: '#00ff88', margin: 0 }}>PX4 Raw Telemetry - {droneName}</h3>
        <div style={{ 
          color: isStale ? '#ff4444' : '#00ff88',
          fontSize: '0.8rem',
          fontFamily: 'monospace'
        }}>
          {isStale ? `⚠️ Stale (${Math.round(connectionAge/1000)}s ago)` : '🟢 Live'}
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '1rem' }}>
        
        {/* Vehicle Status */}
        <div style={{ backgroundColor: '#2d2d2d', padding: '0.75rem', borderRadius: '4px' }}>
          <h4 style={{ color: '#00ff88', margin: '0 0 0.5rem 0' }}>Vehicle Status</h4>
          {vehicleStatus ? (
            <div style={{ fontSize: '0.875rem', fontFamily: 'monospace' }}>
              <div><strong>Arming:</strong> <span style={{ 
                color: vehicleStatus.arming_state === 3 ? '#ff4444' : '#00ff88' 
              }}>{getArmingStateName(vehicleStatus.arming_state)}</span></div>
              <div><strong>Nav State:</strong> <span style={{ color: '#88aaff' }}>
                {getNavStateName(vehicleStatus.nav_state)}
              </span></div>
              <div><strong>Failsafe:</strong> <span style={{ 
                color: vehicleStatus.failsafe ? '#ff4444' : '#00ff88' 
              }}>{vehicleStatus.failsafe ? 'ACTIVE' : 'INACTIVE'}</span></div>
              <div><strong>GCS Lost:</strong> <span style={{ 
                color: vehicleStatus.gcs_connection_lost ? '#ff4444' : '#00ff88' 
              }}>{vehicleStatus.gcs_connection_lost ? 'YES' : 'NO'}</span></div>
              <div><strong>Type:</strong> {vehicleStatus.vehicle_type}</div>
              <div style={{ fontSize: '0.75rem', color: '#888', marginTop: '0.25rem' }}>
                Updated: {formatTimestamp(vehicleStatus.timestamp)}
              </div>
            </div>
          ) : (
            <div style={{ color: '#888', fontStyle: 'italic' }}>No data received</div>
          )}
        </div>

        {/* Position */}
        <div style={{ backgroundColor: '#2d2d2d', padding: '0.75rem', borderRadius: '4px' }}>
          <h4 style={{ color: '#00ff88', margin: '0 0 0.5rem 0' }}>Position (NED)</h4>
          {localPosition ? (
            <div style={{ fontSize: '0.875rem', fontFamily: 'monospace' }}>
              <div><strong>X (North):</strong> {localPosition.x.toFixed(2)}m</div>
              <div><strong>Y (East):</strong> {localPosition.y.toFixed(2)}m</div>
              <div><strong>Z (Down):</strong> {localPosition.z.toFixed(2)}m</div>
              <div><strong>Altitude:</strong> {(-localPosition.z).toFixed(2)}m</div>
              <div><strong>Heading:</strong> {(localPosition.heading * 180 / Math.PI).toFixed(1)}°</div>
              <div><strong>Speed:</strong> {Math.sqrt(localPosition.vx**2 + localPosition.vy**2).toFixed(2)}m/s</div>
              <div style={{ marginTop: '0.25rem' }}>
                <strong>Valid:</strong> 
                <span style={{ color: localPosition.xy_valid ? '#00ff88' : '#ff4444' }}> XY</span>
                <span style={{ color: localPosition.z_valid ? '#00ff88' : '#ff4444' }}> Z</span>
                <span style={{ color: localPosition.v_xy_valid ? '#00ff88' : '#ff4444' }}> VEL</span>
              </div>
              <div style={{ fontSize: '0.75rem', color: '#888', marginTop: '0.25rem' }}>
                Updated: {formatTimestamp(localPosition.timestamp)}
              </div>
            </div>
          ) : (
            <div style={{ color: '#888', fontStyle: 'italic' }}>No data received</div>
          )}
        </div>

        {/* Battery */}
        <div style={{ backgroundColor: '#2d2d2d', padding: '0.75rem', borderRadius: '4px' }}>
          <h4 style={{ color: '#00ff88', margin: '0 0 0.5rem 0' }}>Battery Status</h4>
          {batteryStatus ? (
            <div style={{ fontSize: '0.875rem', fontFamily: 'monospace' }}>
              <div><strong>Voltage:</strong> {batteryStatus.voltage_filtered_v.toFixed(2)}V</div>
              <div><strong>Current:</strong> {batteryStatus.current_filtered_a.toFixed(2)}A</div>
              <div><strong>Remaining:</strong> <span style={{ color: batteryColor }}>
                {(batteryStatus.remaining * 100).toFixed(1)}%
              </span></div>
              <div><strong>Capacity:</strong> {batteryStatus.discharged_mah.toFixed(0)}mAh used</div>
              <div><strong>Time Left:</strong> {batteryStatus.time_remaining_s.toFixed(0)}s</div>
              <div><strong>Temperature:</strong> {batteryStatus.temperature.toFixed(1)}°C</div>
              <div><strong>Cells:</strong> {batteryStatus.cell_count}</div>
              <div><strong>Warning:</strong> <span style={{ 
                color: batteryStatus.warning === 0 ? '#00ff88' : 
                      batteryStatus.warning <= 2 ? '#ff8800' : '#ff4444' 
              }}>{getBatteryWarningName(batteryStatus.warning)}</span></div>
              <div style={{ fontSize: '0.75rem', color: '#888', marginTop: '0.25rem' }}>
                Updated: {formatTimestamp(batteryStatus.timestamp)}
              </div>
            </div>
          ) : (
            <div style={{ color: '#888', fontStyle: 'italic' }}>No data received</div>
          )}
        </div>

        {/* Failsafes */}
        <div style={{ backgroundColor: '#2d2d2d', padding: '0.75rem', borderRadius: '4px' }}>
          <h4 style={{ color: '#00ff88', margin: '0 0 0.5rem 0' }}>Active Failsafes</h4>
          {failsafeFlags ? (
            <div style={{ fontSize: '0.875rem' }}>
              {getActiveFailsafes().length === 0 ? (
                <div style={{ color: '#00ff88' }}>✅ All systems normal</div>
              ) : (
                <div>
                  {getActiveFailsafes().map((failsafe, idx) => (
                    <div key={idx} style={{ color: '#ff4444', marginBottom: '0.25rem' }}>
                      ⚠️ {failsafe}
                    </div>
                  ))}
                </div>
              )}
              <div style={{ fontSize: '0.75rem', color: '#888', marginTop: '0.5rem' }}>
                Battery Warning Level: {failsafeFlags.battery_warning}
              </div>
              <div style={{ fontSize: '0.75rem', color: '#888', marginTop: '0.25rem' }}>
                Updated: {formatTimestamp(failsafeFlags.timestamp)}
              </div>
            </div>
          ) : (
            <div style={{ color: '#888', fontStyle: 'italic' }}>No data received</div>
          )}
        </div>

      </div>
    </div>
  );
};

export default PX4TelemetryDashboard;