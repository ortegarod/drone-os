/**
 * @fileoverview Unified Rosbridge client facade for DroneOS web interface.
 *
 * This module provides a simplified, single-entry-point API for interacting with
 * ROS via rosbridge_suite. It combines connection management, topic subscriptions,
 * and service calls into one cohesive interface.
 *
 * Internally, it coordinates three specialized managers:
 * - RosbridgeClient (core): WebSocket connection lifecycle
 * - TopicManager: ROS topic subscriptions
 * - ServiceManager: ROS service calls
 *
 * @module services/rosbridgeClient
 */

import { ROSBRIDGE_URL } from '../config/rosbridge';
import {
  RosbridgeClient as CoreClient,
  TopicManager,
  ServiceManager,
  ConnectionOptions,
  DroneStateCallback,
  ConnectionCallback,
  LogCallback,
  DroneState,
  ServiceResponse
} from './rosbridge';

/**
 * Unified Rosbridge client facade for drone communication.
 *
 * Provides a simplified API that hides the complexity of managing separate
 * connection, topic, and service managers. All methods are delegated to the
 * appropriate internal manager.
 *
 * **Features:**
 * - Single import for all rosbridge functionality
 * - Coordinated lifecycle management (disconnect cleans up topics automatically)
 * - Connection status callbacks for reactive UI
 * - Topic subscriptions with automatic message parsing
 * - Service calls for drone control (arm/disarm/offboard)
 *
 * @class RosbridgeClient
 *
 * @example
 * ```typescript
 * import { rosbridgeClient } from './services/rosbridgeClient';
 *
 * // Connect to rosbridge
 * rosbridgeClient.connect();
 *
 * // Listen for connection status
 * rosbridgeClient.onConnectionStatusChanged((connected) => {
 *   console.log('Connected:', connected);
 * });
 *
 * // Subscribe to drone telemetry
 * const subId = rosbridgeClient.subscribeToDroneState('drone1', (state) => {
 *   console.log(`Battery: ${state.battery_remaining * 100}%`);
 * });
 *
 * // Call drone service
 * const result = await rosbridgeClient.callArmService('drone1');
 * console.log(result.message);
 * ```
 */
export class RosbridgeClient {
  private core: CoreClient;
  private topics: TopicManager;
  private services: ServiceManager;

  /**
   * Creates a new RosbridgeClient instance.
   *
   * Initializes the three internal managers (core, topics, services) with shared configuration.
   *
   * @param {ConnectionOptions} options - Connection configuration
   * @param {string} [options.url] - WebSocket URL (defaults to ROSBRIDGE_URL from config)
   * @param {number} [options.reconnectInterval] - Reconnect interval in ms
   * @param {number} [options.maxReconnectAttempts] - Max reconnection attempts
   * @param {boolean} [options.enableLogging] - Enable console logging
   */
  constructor(options: ConnectionOptions = {}) {
    const defaultOptions = {
      url: ROSBRIDGE_URL,
      ...options
    };

    this.core = new CoreClient(defaultOptions);
    this.topics = new TopicManager(this.core);
    this.services = new ServiceManager(this.core);
  }

  // ========== Connection Methods ==========

  /**
   * Connects to rosbridge WebSocket server.
   * Delegates to RosbridgeClient (core).
   */
  connect(): void {
    this.core.connect();
  }

  /**
   * Disconnects from rosbridge and unsubscribes from all topics.
   * Cleans up all resources.
   */
  disconnect(): void {
    this.topics.unsubscribeAll();
    this.core.disconnect();
  }

  /**
   * Returns current connection status.
   *
   * @returns {boolean} True if connected
   */
  getConnectionStatus(): boolean {
    return this.core.getConnectionStatus();
  }

  /**
   * Registers callback for connection status changes.
   *
   * @param {ConnectionCallback} callback - Called on connect/disconnect
   */
  onConnectionStatusChanged(callback: ConnectionCallback): void {
    this.core.onConnectionStatusChanged(callback);
  }

  /**
   * Removes connection status callback.
   *
   * @param {ConnectionCallback} callback - Callback to remove
   */
  removeConnectionStatusCallback(callback: ConnectionCallback): void {
    this.core.removeConnectionStatusCallback(callback);
  }

  /**
   * Registers callback for log messages.
   *
   * @param {LogCallback} callback - Called for each log message
   */
  onLogMessage(callback: LogCallback): void {
    this.core.onLogMessage(callback);
  }

  /**
   * Removes log message callback.
   *
   * @param {LogCallback} callback - Callback to remove
   */
  removeLogCallback(callback: LogCallback): void {
    this.core.removeLogCallback(callback);
  }

  // ========== Topic Methods ==========

  /**
   * Subscribes to drone state topic.
   * Delegates to TopicManager.
   *
   * @param {string} droneNamespace - Drone namespace
   * @param {DroneStateCallback} callback - Called on each state update
   * @returns {string} Subscription ID for unsubscribing
   */
  subscribeToDroneState(droneNamespace: string, callback: DroneStateCallback): string {
    return this.topics.subscribeToDroneState(droneNamespace, callback);
  }

  /**
   * Unsubscribes from drone state topic.
   * Delegates to TopicManager.
   *
   * @param {string} subscriptionId - ID from subscribeToDroneState()
   */
  unsubscribeFromDroneState(subscriptionId: string): void {
    this.topics.unsubscribeFromDroneState(subscriptionId);
  }

  /**
   * Returns list of active topic subscriptions.
   * Delegates to TopicManager.
   *
   * @returns {string[]} Array of topic names
   */
  getActiveSubscriptions(): string[] {
    return this.topics.getActiveSubscriptions();
  }

  // ========== Service Methods ==========

  /**
   * Calls GetState service.
   * Delegates to ServiceManager.
   *
   * @async
   * @param {string} droneNamespace - Drone namespace
   * @returns {Promise<any>} Drone state data
   */
  async callGetStateService(droneNamespace: string): Promise<any> {
    return this.services.callGetStateService(droneNamespace);
  }

  /**
   * Calls Arm service to enable motors.
   * Delegates to ServiceManager.
   *
   * @async
   * @param {string} droneNamespace - Drone namespace
   * @returns {Promise<ServiceResponse>} Service response
   */
  async callArmService(droneNamespace: string): Promise<ServiceResponse> {
    return this.services.callArmService(droneNamespace);
  }

  /**
   * Calls Disarm service to disable motors.
   * Delegates to ServiceManager.
   *
   * @async
   * @param {string} droneNamespace - Drone namespace
   * @returns {Promise<ServiceResponse>} Service response
   */
  async callDisarmService(droneNamespace: string): Promise<ServiceResponse> {
    return this.services.callDisarmService(droneNamespace);
  }

  /**
   * Calls SetOffboard service to enable offboard mode.
   * Delegates to ServiceManager.
   *
   * @async
   * @param {string} droneNamespace - Drone namespace
   * @returns {Promise<ServiceResponse>} Service response
   */
  async callSetOffboardService(droneNamespace: string): Promise<ServiceResponse> {
    return this.services.callSetOffboardService(droneNamespace);
  }
}

/**
 * Singleton instance of RosbridgeClient for application-wide use.
 *
 * Configured with default ROSBRIDGE_URL from config.
 * Use this for most cases instead of creating new instances.
 *
 * @constant
 * @type {RosbridgeClient}
 *
 * @example
 * ```typescript
 * import { rosbridgeClient } from './services/rosbridgeClient';
 * rosbridgeClient.connect();
 * ```
 */
export const rosbridgeClient = new RosbridgeClient();

/**
 * Re-exported types for convenience.
 * Allows importing types without navigating to rosbridge/ subdirectory.
 */
export type {
  DroneState,
  ConnectionOptions,
  ServiceResponse,
  DroneStateCallback,
  ConnectionCallback,
  LogCallback
};
