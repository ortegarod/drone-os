/**
 * @fileoverview Type definitions for the Rosbridge WebSocket client module.
 * Provides TypeScript interfaces for drone telemetry, connection management,
 * and ROS service communication.
 *
 * @module rosbridge/types
 */

/**
 * Comprehensive drone state information received from ROS topics.
 * Contains telemetry data including position, velocity, battery, GPS, and system health.
 *
 * @interface DroneState
 * @property {Object} header - ROS message header with timestamp and frame information
 * @property {string} drone_name - Unique identifier for the drone
 */
export interface DroneState {
  /** ROS message header */
  header: {
    /** Timestamp in seconds and nanoseconds */
    stamp: { sec: number; nanosec: number };
    /** Reference frame ID (e.g., 'base_link', 'map') */
    frame_id: string;
  };

  /** Unique drone identifier */
  drone_name: string;

  // Position data (NED frame - North-East-Down coordinate system)
  /** Local X position in meters (North) */
  local_x: number;
  /** Local Y position in meters (East) */
  local_y: number;
  /** Local Z position in meters (Down, negative = up) */
  local_z: number;
  /** Yaw angle in radians */
  local_yaw: number;
  /** Whether position data is valid */
  position_valid: boolean;

  // Velocity data (NED frame)
  /** Velocity in X direction (m/s) */
  velocity_x: number;
  /** Velocity in Y direction (m/s) */
  velocity_y: number;
  /** Velocity in Z direction (m/s) */
  velocity_z: number;
  /** Whether velocity data is valid */
  velocity_valid: boolean;

  // State information
  /** Current navigation state (e.g., 'MANUAL', 'OFFBOARD', 'AUTO') */
  nav_state: string;
  /** Arming state (e.g., 'ARMED', 'DISARMED') */
  arming_state: string;
  /** Landing state (e.g., 'IN_AIR', 'LANDED') */
  landing_state: string;

  // Global position (GPS)
  /** GPS latitude in degrees */
  latitude: number;
  /** GPS longitude in degrees */
  longitude: number;
  /** GPS altitude in meters (AMSL - Above Mean Sea Level) */
  altitude: number;
  /** Whether GPS position is valid */
  global_position_valid: boolean;

  // Battery & Power
  /** Battery voltage in volts */
  battery_voltage: number;
  /** Battery current in amperes (negative = charging) */
  battery_current: number;
  /** Remaining battery percentage (0.0 to 1.0) */
  battery_remaining: number;
  /** Estimated remaining flight time in seconds */
  battery_time_remaining: number;
  /** Battery temperature in Celsius */
  battery_temperature: number;
  /** Battery warning level (e.g., 'NONE', 'LOW', 'CRITICAL') */
  battery_warning: string;
  /** Whether battery data is valid */
  battery_valid: boolean;

  // GPS detailed info
  /** GPS fix type (e.g., 'NO_FIX', '2D', '3D', 'RTK') */
  gps_fix_type: string;
  /** Number of satellites used for position fix */
  gps_satellites_used: number;
  /** Horizontal Dilution of Precision */
  gps_hdop: number;
  /** Vertical Dilution of Precision */
  gps_vdop: number;
  /** Horizontal accuracy in meters */
  gps_accuracy_horizontal: number;
  /** Vertical accuracy in meters */
  gps_accuracy_vertical: number;
  /** Whether GPS jamming is detected */
  gps_jamming_detected: boolean;
  /** Whether GPS spoofing is detected */
  gps_spoofing_detected: boolean;

  // System health
  /** Overall system health score (0-100) */
  system_health_score: number;
  /** List of active warning messages */
  active_warnings: string[];
  /** List of critical failure messages */
  critical_failures: string[];
  /** Whether the drone is safe to arm */
  can_arm: boolean;
  /** Whether manual control signal is lost */
  manual_control_lost: boolean;
  /** Whether ground control station connection is lost */
  gcs_connection_lost: boolean;
  /** Whether geofence boundary is breached */
  geofence_breached: boolean;

  // Communication status
  /** RC signal strength (0-100) */
  rc_signal_strength: number;
  /** Whether RC signal is valid */
  rc_signal_valid: boolean;
  /** Telemetry link quality (0-100) */
  telemetry_link_quality: number;
  /** Packet loss rate (0.0 to 1.0) */
  packet_loss_rate: number;

  // Flight performance
  /** Wind speed in m/s */
  wind_speed: number;
  /** Wind direction in degrees */
  wind_direction: number;
  /** Rate of altitude change in m/s */
  altitude_rate: number;

  // Safety status
  /** Current geofence status (e.g., 'INSIDE', 'WARNING', 'BREACH') */
  geofence_status: string;
  /** Time elapsed since takeoff in seconds */
  flight_time_elapsed: number;
  /** Maximum allowed flight time in seconds */
  flight_time_limit: number;
}

/**
 * Configuration options for Rosbridge connection.
 *
 * @interface ConnectionOptions
 */
export interface ConnectionOptions {
  /** WebSocket URL for rosbridge server (default: 'ws://localhost:9090') */
  url?: string;
  /** Interval between reconnection attempts in milliseconds (default: 3000) */
  reconnectInterval?: number;
  /** Maximum number of reconnection attempts (default: 10) */
  maxReconnectAttempts?: number;
  /** Enable console logging (default: true) */
  enableLogging?: boolean;
}

/**
 * Standard response format for ROS service calls.
 *
 * @interface ServiceResponse
 */
export interface ServiceResponse {
  /** Whether the service call succeeded */
  success: boolean;
  /** Human-readable status or error message */
  message: string;
}

/**
 * Callback function invoked when drone state is updated.
 *
 * @callback DroneStateCallback
 * @param {DroneState} state - The updated drone state
 */
export type DroneStateCallback = (state: DroneState) => void;

/**
 * Callback function invoked when connection status changes.
 *
 * @callback ConnectionCallback
 * @param {boolean} connected - Whether the connection is established
 * @param {string} [error] - Optional error message if connection failed
 */
export type ConnectionCallback = (connected: boolean, error?: string) => void;

/**
 * Callback function for log messages.
 *
 * @callback LogCallback
 * @param {'info' | 'warn' | 'error'} level - Log severity level
 * @param {string} message - Log message content
 */
export type LogCallback = (level: 'info' | 'warn' | 'error', message: string) => void;
