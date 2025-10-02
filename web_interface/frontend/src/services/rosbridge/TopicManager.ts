/**
 * @fileoverview ROS topic subscription manager.
 * Handles subscribing/unsubscribing to ROS topics via rosbridge,
 * with focus on drone telemetry topics.
 *
 * @module rosbridge/TopicManager
 */

import * as ROSLIB from 'roslib';
import { RosbridgeClient } from './RosbridgeClient';
import { DroneState, DroneStateCallback } from './types';

/**
 * Manages ROS topic subscriptions for drone telemetry.
 *
 * Provides:
 * - Subscribe to drone state topics
 * - Automatic callback management
 * - Topic lifecycle management
 * - Bulk unsubscribe operations
 *
 * @class TopicManager
 *
 * @example
 * ```typescript
 * const client = new RosbridgeClient();
 * const topicManager = new TopicManager(client);
 *
 * const subId = topicManager.subscribeToDroneState('drone1', (state) => {
 *   console.log('Battery:', state.battery_remaining);
 * });
 *
 * // Later...
 * topicManager.unsubscribeFromDroneState(subId);
 * ```
 */
export class TopicManager {
  private client: RosbridgeClient;
  private droneStateCallbacks: Map<string, DroneStateCallback> = new Map();
  private activeSubscriptions: Map<string, ROSLIB.Topic> = new Map();

  /**
   * Creates a new TopicManager instance.
   *
   * @param {RosbridgeClient} client - Connected RosbridgeClient instance
   */
  constructor(client: RosbridgeClient) {
    this.client = client;
  }

  /**
   * Subscribes to drone state updates for a specific drone.
   *
   * Creates a ROSLIB.Topic subscription to the drone's telemetry topic.
   * If not connected, stores the callback but won't receive updates until connected.
   *
   * Topic: `/{droneNamespace}/drone_state`
   * Message Type: `drone_interfaces/msg/DroneState`
   * Update Rate: 10Hz (throttled)
   *
   * @public
   * @param {string} droneNamespace - Drone namespace (e.g., 'drone1', 'px4_1')
   * @param {DroneStateCallback} callback - Function called on each state update
   * @returns {string} Subscription ID for later unsubscription
   *
   * @example
   * ```typescript
   * const subId = topicManager.subscribeToDroneState('drone1', (state) => {
   *   console.log(`Altitude: ${-state.local_z}m`);
   *   console.log(`Battery: ${state.battery_remaining * 100}%`);
   * });
   * ```
   */
  subscribeToDroneState(droneNamespace: string, callback: DroneStateCallback): string {
    const topicName = `/${droneNamespace}/drone_state`;
    const subscriptionId = `drone_state_${droneNamespace}`;

    this.droneStateCallbacks.set(subscriptionId, callback);

    const ros = this.client.getRos();
    if (!ros) {
      console.warn('[TopicManager] Cannot subscribe: not connected to ROS');
      return subscriptionId;
    }

    const topic = new ROSLIB.Topic({
      ros: ros,
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
    console.info(`[TopicManager] Subscribed to drone state for ${droneNamespace}`);
    return subscriptionId;
  }

  /**
   * Unsubscribes from drone state updates.
   *
   * Removes callback, unsubscribes from ROS topic, and cleans up resources.
   *
   * @public
   * @param {string} subscriptionId - ID returned from subscribeToDroneState()
   * @returns {void}
   *
   * @example
   * ```typescript
   * const subId = topicManager.subscribeToDroneState('drone1', callback);
   * // Later...
   * topicManager.unsubscribeFromDroneState(subId);
   * ```
   */
  unsubscribeFromDroneState(subscriptionId: string): void {
    const callback = this.droneStateCallbacks.get(subscriptionId);
    if (!callback) {
      console.warn(`[TopicManager] No subscription found with ID: ${subscriptionId}`);
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

    console.info(`[TopicManager] Unsubscribed from drone state for ${droneNamespace}`);
  }

  /**
   * Unsubscribes from all active topic subscriptions.
   *
   * Called automatically by facade on disconnect().
   * Useful for cleanup when switching drone targets or shutting down.
   *
   * @public
   * @returns {void}
   */
  unsubscribeAll(): void {
    this.activeSubscriptions.forEach(topic => topic.unsubscribe());
    this.activeSubscriptions.clear();
    this.droneStateCallbacks.clear();
    console.info('[TopicManager] Unsubscribed from all topics');
  }

  /**
   * Returns list of currently active topic names.
   *
   * @public
   * @returns {string[]} Array of topic names (e.g., ['/drone1/drone_state'])
   */
  getActiveSubscriptions(): string[] {
    return Array.from(this.activeSubscriptions.keys());
  }
}
