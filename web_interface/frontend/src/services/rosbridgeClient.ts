/**
 * Rosbridge WebSocket Client for Real-time Drone Telemetry
 *
 * This module provides a TypeScript client for connecting to rosbridge WebSocket server
 * and subscribing to drone telemetry topics for real-time status updates.
 */

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
  private ws: WebSocket | null = null;
  private url: string;
  private reconnectInterval: number;
  private maxReconnectAttempts: number;
  private pingInterval: number;
  private enableLogging: boolean;
  
  private reconnectAttempts = 0;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private pingTimer: NodeJS.Timeout | null = null;
  private isConnected = false;
  private shouldReconnect = true;
  
  // Event callbacks
  private droneStateCallbacks: Map<string, DroneStateCallback> = new Map();
  private connectionCallbacks: Set<ConnectionCallback> = new Set();
  private logCallbacks: Set<LogCallback> = new Set();
  
  // Subscription tracking
  private activeSubscriptions: Set<string> = new Set();
  private subscriptionQueue: RosbridgeMessage[] = [];

  constructor(options: ConnectionOptions = {}) {
    this.url = options.url || ROSBRIDGE_URL;
    this.reconnectInterval = options.reconnectInterval || 3000;
    this.maxReconnectAttempts = options.maxReconnectAttempts || 10;
    this.pingInterval = options.pingInterval || 30000;
    this.enableLogging = options.enableLogging !== false;
  }

  /**
   * Connect to rosbridge WebSocket server
   */
  connect(): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.log('warn', 'Already connected to rosbridge');
      return;
    }

    this.log('info', `Connecting to rosbridge at ${this.url}`);
    this.shouldReconnect = true;

    try {
      this.ws = new WebSocket(this.url);
      this.setupWebSocketHandlers();
    } catch (error) {
      this.log('error', `Failed to create WebSocket connection: ${error}`);
      this.scheduleReconnect();
    }
  }

  /**
   * Disconnect from rosbridge server
   */
  disconnect(): void {
    this.shouldReconnect = false;
    this.clearTimers();
    
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    
    this.isConnected = false;
    this.reconnectAttempts = 0;
    this.notifyConnectionStatus(false);
  }

  /**
   * Subscribe to drone state updates for a specific drone
   */
  subscribeToDroneState(droneNamespace: string, callback: DroneStateCallback): string {
    const topic = `/${droneNamespace}/drone_state`;
    const subscriptionId = `drone_state_${droneNamespace}`;
    
    this.droneStateCallbacks.set(subscriptionId, callback);
    
    const subscribeMsg: RosbridgeMessage = {
      op: 'subscribe',
      topic: topic,
      type: 'drone_interfaces/DroneState',
      throttle_rate: 100, // 10Hz updates
      queue_length: 1,
      compression: 'none'
    };

    if (this.isConnected) {
      this.sendMessage(subscribeMsg);
      this.activeSubscriptions.add(topic);
    } else {
      this.subscriptionQueue.push(subscribeMsg);
    }

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
    const topic = `/${droneNamespace}/drone_state`;
    
    const unsubscribeMsg: RosbridgeMessage = {
      op: 'unsubscribe',
      topic: topic
    };

    if (this.isConnected) {
      this.sendMessage(unsubscribeMsg);
      this.activeSubscriptions.delete(topic);
    }

    this.log('info', `Unsubscribed from drone state for ${droneNamespace}`);
  }

  /**
   * Call GetState service for a specific drone
   */
  async callGetStateService(droneNamespace: string): Promise<any> {
    return new Promise((resolve, reject) => {
      if (!this.isConnected) {
        reject(new Error('Not connected to rosbridge'));
        return;
      }

      const callId = `get_state_${Date.now()}`;
      const serviceMsg: RosbridgeMessage = {
        op: 'call_service',
        service: `/${droneNamespace}/get_state`,
        // ROS 2 rosbridge commonly uses the 'pkg/srv/ServiceName' format
        type: 'drone_interfaces/GetState',
        id: callId
      };

      // Set up one-time response handler
      const timeout = setTimeout(() => {
        reject(new Error('Service call timeout'));
      }, 5000);

      const handleResponse = (event: MessageEvent) => {
        try {
          const response = JSON.parse(event.data);
          if (response.op === 'service_response' && response.id === callId) {
            clearTimeout(timeout);
            this.ws?.removeEventListener('message', handleResponse);
            
            if (response.result) {
              resolve(response.values);
            } else {
              reject(new Error('Service call failed'));
            }
          }
        } catch (error) {
          // Ignore JSON parse errors for other messages
        }
      };

      this.ws?.addEventListener('message', handleResponse);
      this.sendMessage(serviceMsg);
    });
  }

  /**
   * Call Arm service for a specific drone
   */
  async callArmService(droneNamespace: string): Promise<any> {
    return new Promise((resolve, reject) => {
      console.log('[TRACE] callArmService called for:', droneNamespace);
      console.log('[TRACE] WebSocket connected:', this.isConnected);

      if (!this.isConnected) {
        reject(new Error('Not connected to rosbridge'));
        return;
      }

      const callId = `arm_${Date.now()}`;
      const serviceMsg: RosbridgeMessage = {
        op: 'call_service',
        service: `/${droneNamespace}/arm`,
        type: 'std_srvs/Trigger',
        id: callId,
        args: {}
      };

      console.log('[TRACE] Sending ARM service message:', JSON.stringify(serviceMsg));

      const timeout = setTimeout(() => {
        console.log('[TRACE] ARM service call timed out after 5 seconds');
        reject(new Error('Service call timeout'));
      }, 5000);

      const handleResponse = (event: MessageEvent) => {
        try {
          const response = JSON.parse(event.data);
          console.log('[TRACE] Received WebSocket message:', response);

          if (response.op === 'service_response' && response.id === callId) {
            console.log('[TRACE] ARM service response matched:', response);
            clearTimeout(timeout);
            this.ws?.removeEventListener('message', handleResponse);

            if (response.result !== undefined) {
              resolve({
                success: response.result,
                message: response.values?.message || (response.result ? 'Armed successfully' : 'Failed to arm')
              });
            } else {
              reject(new Error('Invalid service response'));
            }
          }
        } catch (error) {
          console.log('[TRACE] Error parsing WebSocket message:', error);
        }
      };

      this.ws?.addEventListener('message', handleResponse);
      this.sendMessage(serviceMsg);
    });
  }

  /**
   * Call Disarm service for a specific drone
   */
  async callDisarmService(droneNamespace: string): Promise<any> {
    return new Promise((resolve, reject) => {
      if (!this.isConnected) {
        reject(new Error('Not connected to rosbridge'));
        return;
      }

      const callId = `disarm_${Date.now()}`;
      const serviceMsg: RosbridgeMessage = {
        op: 'call_service',
        service: `/${droneNamespace}/disarm`,
        type: 'std_srvs/Trigger',
        id: callId,
        args: {}
      };

      const timeout = setTimeout(() => {
        reject(new Error('Service call timeout'));
      }, 5000);

      const handleResponse = (event: MessageEvent) => {
        try {
          const response = JSON.parse(event.data);
          if (response.op === 'service_response' && response.id === callId) {
            clearTimeout(timeout);
            this.ws?.removeEventListener('message', handleResponse);

            if (response.result !== undefined) {
              resolve({
                success: response.result,
                message: response.values?.message || (response.result ? 'Disarmed successfully' : 'Failed to disarm')
              });
            } else {
              reject(new Error('Invalid service response'));
            }
          }
        } catch (error) {
          // Ignore JSON parse errors for other messages
        }
      };

      this.ws?.addEventListener('message', handleResponse);
      this.sendMessage(serviceMsg);
    });
  }

  /**
   * Call SetOffboard service for a specific drone
   */
  async callSetOffboardService(droneNamespace: string): Promise<any> {
    return new Promise((resolve, reject) => {
      if (!this.isConnected) {
        reject(new Error('Not connected to rosbridge'));
        return;
      }

      const callId = `set_offboard_${Date.now()}`;
      const serviceMsg: RosbridgeMessage = {
        op: 'call_service',
        service: `/${droneNamespace}/set_offboard`,
        type: 'std_srvs/Trigger',
        id: callId,
        args: {}
      };

      const timeout = setTimeout(() => {
        reject(new Error('Service call timeout'));
      }, 5000);

      const handleResponse = (event: MessageEvent) => {
        try {
          const response = JSON.parse(event.data);
          if (response.op === 'service_response' && response.id === callId) {
            clearTimeout(timeout);
            this.ws?.removeEventListener('message', handleResponse);

            if (response.result !== undefined) {
              resolve({
                success: response.result,
                message: response.values?.message || (response.result ? 'Offboard mode enabled' : 'Failed to enable offboard mode')
              });
            } else {
              reject(new Error('Invalid service response'));
            }
          }
        } catch (error) {
          // Ignore JSON parse errors for other messages
        }
      };

      this.ws?.addEventListener('message', handleResponse);
      this.sendMessage(serviceMsg);
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
    return Array.from(this.activeSubscriptions);
  }

  private setupWebSocketHandlers(): void {
    if (!this.ws) return;

    this.ws.onopen = () => {
      this.log('info', 'Connected to rosbridge WebSocket server');
      this.isConnected = true;
      this.reconnectAttempts = 0;
      this.notifyConnectionStatus(true);
      this.startPingTimer();
      this.processSubscriptionQueue();
    };

    this.ws.onmessage = (event) => {
      this.handleIncomingMessage(event);
    };

    this.ws.onclose = (event) => {
      this.log('warn', `WebSocket connection closed: ${event.code} - ${event.reason}`);
      this.isConnected = false;
      this.clearTimers();
      this.notifyConnectionStatus(false, `Connection closed: ${event.reason}`);
      
      if (this.shouldReconnect) {
        this.scheduleReconnect();
      }
    };

    this.ws.onerror = (error) => {
      this.log('error', `WebSocket error: ${error}`);
      this.notifyConnectionStatus(false, 'WebSocket error occurred');
    };
  }

  private handleIncomingMessage(event: MessageEvent): void {
    try {
      const message: RosbridgeMessage = JSON.parse(event.data);
      
      if (message.op === 'publish' && message.topic && message.msg) {
        this.handleTopicMessage(message.topic, message.msg);
      } else if (message.op === 'status') {
        this.log('info', `Rosbridge status: ${message.msg}`);
      }
    } catch (error) {
      this.log('error', `Failed to parse incoming message: ${error}`);
    }
  }

  private handleTopicMessage(topic: string, msg: any): void {
    // Handle drone state messages
    if (topic.endsWith('/drone_state')) {
      const droneNamespace = topic.split('/')[1];
      const subscriptionId = `drone_state_${droneNamespace}`;
      const callback = this.droneStateCallbacks.get(subscriptionId);
      
      if (callback) {
        callback(msg as DroneState);
      }
    }
  }

  private sendMessage(message: RosbridgeMessage): void {
    console.log('[TRACE] sendMessage called with:', message);
    console.log('[TRACE] WebSocket state:', this.ws?.readyState, '(OPEN=1)');

    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      console.log('[TRACE] Cannot send message: WebSocket not connected');
      this.log('warn', 'Cannot send message: WebSocket not connected');
      return;
    }

    try {
      const messageStr = JSON.stringify(message);
      console.log('[TRACE] Sending message to WebSocket:', messageStr);
      this.ws.send(messageStr);
      console.log('[TRACE] Message sent successfully');
    } catch (error) {
      console.error('[TRACE] Failed to send message:', error);
      this.log('error', `Failed to send message: ${error}`);
    }
  }

  private processSubscriptionQueue(): void {
    while (this.subscriptionQueue.length > 0) {
      const subscription = this.subscriptionQueue.shift();
      if (subscription) {
        this.sendMessage(subscription);
        if (subscription.topic) {
          this.activeSubscriptions.add(subscription.topic);
        }
      }
    }
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

  private startPingTimer(): void {
    // Ping disabled - rosbridge doesn't support 'status' operation
    // WebSocket connection itself provides keep-alive functionality
    this.pingTimer = null;
  }

  private clearTimers(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    
    if (this.pingTimer) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
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
