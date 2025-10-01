/**
 * Rosbridge WebSocket Client for Real-time Drone Telemetry
 *
 * This module provides a TypeScript client for connecting to rosbridge WebSocket server
 * and subscribing to drone telemetry topics for real-time status updates.
 *
 * Uses roslibjs for ROS communication.
 */

import * as ROSLIB from 'roslib';
import { ROSBRIDGE_URL } from '../config/rosbridge';

export interface DroneState {
  header: {
    stamp: { sec: number; nanosec: number };
    frame_id: string;
  };
  drone_name: string;
  
  // Position data (NED frame)
  local_x: number;
  local_y: number;
  local_z: number;
  local_yaw: number;
  position_valid: boolean;
  
  // Velocity data (NED frame)
  velocity_x: number;
  velocity_y: number;
  velocity_z: number;
  velocity_valid: boolean;
  
  // State information
  nav_state: string;
  arming_state: string;
  landing_state: string;
  
  // Global position (GPS)
  latitude: number;
  longitude: number;
  altitude: number;
  global_position_valid: boolean;
  
  // Battery & Power
  battery_voltage: number;
  battery_current: number;
  battery_remaining: number;
  battery_time_remaining: number;
  battery_temperature: number;
  battery_warning: string;
  battery_valid: boolean;
  
  // GPS detailed info
  gps_fix_type: string;
  gps_satellites_used: number;
  gps_hdop: number;
  gps_vdop: number;
  gps_accuracy_horizontal: number;
  gps_accuracy_vertical: number;
  gps_jamming_detected: boolean;
  gps_spoofing_detected: boolean;
  
  // System health
  system_health_score: number;
  active_warnings: string[];
  critical_failures: string[];
  can_arm: boolean;
  manual_control_lost: boolean;
  gcs_connection_lost: boolean;
  geofence_breached: boolean;
  
  // Communication status
  rc_signal_strength: number;
  rc_signal_valid: boolean;
  telemetry_link_quality: number;
  packet_loss_rate: number;
  
  // Flight performance
  wind_speed: number;
  wind_direction: number;
  altitude_rate: number;
  
  // Safety status
  geofence_status: string;
  flight_time_elapsed: number;
  flight_time_limit: number;
}

export interface RosbridgeMessage {
  op: string;
  topic?: string;
  type?: string;
  msg?: any;
  service?: string;
  args?: any;
  id?: string;
  throttle_rate?: number;
  queue_length?: number;
  fragment_size?: number;
  compression?: string;
}

export interface ConnectionOptions {
  url?: string;
  reconnectInterval?: number;
  maxReconnectAttempts?: number;
  pingInterval?: number;
  enableLogging?: boolean;
}

export type DroneStateCallback = (state: DroneState) => void;
export type ConnectionCallback = (connected: boolean, error?: string) => void;
export type LogCallback = (level: 'info' | 'warn' | 'error', message: string) => void;

export class RosbridgeClient {
  private ros: ROSLIB.Ros | null = null;
  private url: string;
  private reconnectInterval: number;
  private maxReconnectAttempts: number;
  private enableLogging: boolean;

  private reconnectAttempts = 0;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private isConnected = false;
  private shouldReconnect = true;

  // Event callbacks
  private droneStateCallbacks: Map<string, DroneStateCallback> = new Map();
  private connectionCallbacks: Set<ConnectionCallback> = new Set();
  private logCallbacks: Set<LogCallback> = new Set();

  // Subscription tracking
  private activeSubscriptions: Map<string, ROSLIB.Topic> = new Map();

  constructor(options: ConnectionOptions = {}) {
    this.url = options.url || ROSBRIDGE_URL;
    this.reconnectInterval = options.reconnectInterval || 3000;
    this.maxReconnectAttempts = options.maxReconnectAttempts || 10;
    this.enableLogging = options.enableLogging !== false;
  }

  /**
   * Connect to rosbridge WebSocket server
   */
  connect(): void {
    if (this.isConnected) {
      this.log('warn', 'Already connected to rosbridge');
      return;
    }

    this.log('info', `Connecting to rosbridge at ${this.url}`);
    this.shouldReconnect = true;

    try {
      this.ros = new ROSLIB.Ros({
        url: this.url
      });

      this.setupRosHandlers();
    } catch (error) {
      this.log('error', `Failed to create ROS connection: ${error}`);
      this.scheduleReconnect();
    }
  }

  /**
   * Disconnect from rosbridge server
   */
  disconnect(): void {
    this.shouldReconnect = false;
    this.clearTimers();

    // Unsubscribe from all topics
    this.activeSubscriptions.forEach(topic => topic.unsubscribe());
    this.activeSubscriptions.clear();

    if (this.ros) {
      this.ros.close();
      this.ros = null;
    }

    this.isConnected = false;
    this.reconnectAttempts = 0;
    this.notifyConnectionStatus(false);
  }

  /**
   * Subscribe to drone state updates for a specific drone
   */
  subscribeToDroneState(droneNamespace: string, callback: DroneStateCallback): string {
    const topicName = `/${droneNamespace}/drone_state`;
    const subscriptionId = `drone_state_${droneNamespace}`;

    this.droneStateCallbacks.set(subscriptionId, callback);

    if (!this.ros) {
      this.log('warn', 'Cannot subscribe: not connected to ROS');
      return subscriptionId;
    }

    const topic = new ROSLIB.Topic({
      ros: this.ros,
      name: topicName,
      messageType: 'drone_interfaces/msg/DroneState',
      throttle_rate: 100, // 10Hz updates
      queue_length: 1
    });

    topic.subscribe((message: any) => {
      const cb = this.droneStateCallbacks.get(subscriptionId);
      if (cb) {
        cb(message as DroneState);
      }
    });

    this.activeSubscriptions.set(topicName, topic);
    this.log('info', `Subscribed to drone state for ${droneNamespace}`);
    return subscriptionId;
  }

  /**
   * Unsubscribe from drone state updates
   */
  unsubscribeFromDroneState(subscriptionId: string): void {
    const callback = this.droneStateCallbacks.get(subscriptionId);
    if (!callback) {
      this.log('warn', `No subscription found with ID: ${subscriptionId}`);
      return;
    }

    this.droneStateCallbacks.delete(subscriptionId);

    const droneNamespace = subscriptionId.replace('drone_state_', '');
    const topicName = `/${droneNamespace}/drone_state`;

    const topic = this.activeSubscriptions.get(topicName);
    if (topic) {
      topic.unsubscribe();
      this.activeSubscriptions.delete(topicName);
    }

    this.log('info', `Unsubscribed from drone state for ${droneNamespace}`);
  }

  /**
   * Call GetState service for a specific drone
   */
  async callGetStateService(droneNamespace: string): Promise<any> {
    return new Promise((resolve, reject) => {
      if (!this.ros || !this.isConnected) {
        reject(new Error('Not connected to rosbridge'));
        return;
      }

      const service = new ROSLIB.Service({
        ros: this.ros,
        name: `/${droneNamespace}/get_state`,
        serviceType: 'drone_interfaces/srv/GetState'
      });

      const request = new ROSLIB.ServiceRequest({});

      service.callService(request, (result) => {
        resolve(result);
      }, (error) => {
        reject(new Error(`Service call failed: ${error}`));
      });
    });
  }

  /**
   * Call Arm service for a specific drone
   */
  async callArmService(droneNamespace: string): Promise<any> {
    return new Promise((resolve, reject) => {
      console.log('[TRACE] callArmService called for:', droneNamespace);
      console.log('[TRACE] ROS connected:', this.isConnected);

      if (!this.ros || !this.isConnected) {
        reject(new Error('Not connected to rosbridge'));
        return;
      }

      const service = new ROSLIB.Service({
        ros: this.ros,
        name: `/${droneNamespace}/arm`,
        serviceType: 'std_srvs/srv/Trigger'
      });

      const request = new ROSLIB.ServiceRequest({});

      console.log('[TRACE] Calling ARM service...');

      service.callService(request, (result: any) => {
        console.log('[TRACE] ARM service response:', result);
        resolve({
          success: result.success || false,
          message: result.message || (result.success ? 'Armed successfully' : 'Failed to arm')
        });
      }, (error: string) => {
        console.log('[TRACE] ARM service error:', error);
        reject(new Error(`Arm service failed: ${error}`));
      });
    });
  }

  /**
   * Call Disarm service for a specific drone
   */
  async callDisarmService(droneNamespace: string): Promise<any> {
    return new Promise((resolve, reject) => {
      if (!this.ros || !this.isConnected) {
        reject(new Error('Not connected to rosbridge'));
        return;
      }

      const service = new ROSLIB.Service({
        ros: this.ros,
        name: `/${droneNamespace}/disarm`,
        serviceType: 'std_srvs/srv/Trigger'
      });

      const request = new ROSLIB.ServiceRequest({});

      service.callService(request, (result: any) => {
        resolve({
          success: result.success || false,
          message: result.message || (result.success ? 'Disarmed successfully' : 'Failed to disarm')
        });
      }, (error: string) => {
        reject(new Error(`Disarm service failed: ${error}`));
      });
    });
  }

  /**
   * Call SetOffboard service for a specific drone
   */
  async callSetOffboardService(droneNamespace: string): Promise<any> {
    return new Promise((resolve, reject) => {
      if (!this.ros || !this.isConnected) {
        reject(new Error('Not connected to rosbridge'));
        return;
      }

      const service = new ROSLIB.Service({
        ros: this.ros,
        name: `/${droneNamespace}/set_offboard`,
        serviceType: 'std_srvs/srv/Trigger'
      });

      const request = new ROSLIB.ServiceRequest({});

      service.callService(request, (result: any) => {
        resolve({
          success: result.success || false,
          message: result.message || (result.success ? 'Offboard mode enabled' : 'Failed to enable offboard mode')
        });
      }, (error: string) => {
        reject(new Error(`Set offboard service failed: ${error}`));
      });
    });
  }

  /**
   * Add connection status callback
   */
  onConnectionStatusChanged(callback: ConnectionCallback): void {
    this.connectionCallbacks.add(callback);
  }

  /**
   * Remove connection status callback
   */
  removeConnectionStatusCallback(callback: ConnectionCallback): void {
    this.connectionCallbacks.delete(callback);
  }

  /**
   * Add log message callback
   */
  onLogMessage(callback: LogCallback): void {
    this.logCallbacks.add(callback);
  }

  /**
   * Remove log message callback
   */
  removeLogCallback(callback: LogCallback): void {
    this.logCallbacks.delete(callback);
  }

  /**
   * Get current connection status
   */
  getConnectionStatus(): boolean {
    return this.isConnected;
  }

  /**
   * Get list of active subscriptions
   */
  getActiveSubscriptions(): string[] {
    return Array.from(this.activeSubscriptions.keys());
  }

  private setupRosHandlers(): void {
    if (!this.ros) return;

    this.ros.on('connection', () => {
      this.log('info', 'Connected to rosbridge server');
      this.isConnected = true;
      this.reconnectAttempts = 0;
      this.notifyConnectionStatus(true);
    });

    this.ros.on('error', (error: any) => {
      this.log('error', `ROS connection error: ${error}`);
      this.notifyConnectionStatus(false, 'ROS connection error occurred');
    });

    this.ros.on('close', () => {
      this.log('warn', 'ROS connection closed');
      this.isConnected = false;
      this.clearTimers();
      this.notifyConnectionStatus(false, 'Connection closed');

      if (this.shouldReconnect) {
        this.scheduleReconnect();
      }
    });
  }

  private scheduleReconnect(): void {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      this.log('error', 'Max reconnection attempts reached. Giving up.');
      this.shouldReconnect = false;
      return;
    }

    this.reconnectAttempts++;
    const delay = this.reconnectInterval * Math.min(this.reconnectAttempts, 5); // Exponential backoff, capped
    
    this.log('info', `Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts})`);
    
    this.reconnectTimer = setTimeout(() => {
      if (this.shouldReconnect) {
        this.connect();
      }
    }, delay);
  }

  private clearTimers(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  private notifyConnectionStatus(connected: boolean, error?: string): void {
    this.connectionCallbacks.forEach(callback => {
      try {
        callback(connected, error);
      } catch (e) {
        this.log('error', `Error in connection callback: ${e}`);
      }
    });
  }

  private log(level: 'info' | 'warn' | 'error', message: string): void {
    if (this.enableLogging) {
      console[level](`[RosbridgeClient] ${message}`);
    }
    
    this.logCallbacks.forEach(callback => {
      try {
        callback(level, message);
      } catch (e) {
        console.error(`Error in log callback: ${e}`);
      }
    });
  }
}

// Export singleton instance for easy use
export const rosbridgeClient = new RosbridgeClient();
