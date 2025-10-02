/**
 * @fileoverview ROS service call manager for drone control operations.
 * Provides methods for calling ROS services like arm, disarm, and mode changes.
 *
 * @module rosbridge/ServiceManager
 */

import * as ROSLIB from 'roslib';
import { RosbridgeClient } from './RosbridgeClient';
import { ServiceResponse } from './types';

/**
 * Manages ROS service calls for drone flight control operations.
 *
 * Provides:
 * - Arm/disarm drone motors
 * - Enable offboard flight mode
 * - Query drone state
 * - Promise-based async API
 *
 * All service calls return Promise<ServiceResponse> with success/message fields.
 *
 * @class ServiceManager
 *
 * @example
 * ```typescript
 * const client = new RosbridgeClient();
 * const serviceManager = new ServiceManager(client);
 *
 * try {
 *   const result = await serviceManager.callArmService('drone1');
 *   if (result.success) {
 *     console.log('Armed successfully');
 *   }
 * } catch (error) {
 *   console.error('Arm failed:', error);
 * }
 * ```
 */
export class ServiceManager {
  private client: RosbridgeClient;

  /**
   * Creates a new ServiceManager instance.
   *
   * @param {RosbridgeClient} client - Connected RosbridgeClient instance
   */
  constructor(client: RosbridgeClient) {
    this.client = client;
  }

  /**
   * Calls GetState service to retrieve current drone state.
   *
   * Service: `/{droneNamespace}/get_state`
   * Type: `drone_interfaces/srv/GetState`
   *
   * @public
   * @async
   * @param {string} droneNamespace - Drone namespace (e.g., 'drone1')
   * @returns {Promise<any>} Promise resolving to drone state data
   * @throws {Error} If not connected or service call fails
   *
   * @example
   * ```typescript
   * const state = await serviceManager.callGetStateService('drone1');
   * console.log('Altitude:', state.altitude);
   * ```
   */
  async callGetStateService(droneNamespace: string): Promise<any> {
    return new Promise((resolve, reject) => {
      const ros = this.client.getRos();
      if (!ros || !this.client.getConnectionStatus()) {
        reject(new Error('Not connected to rosbridge'));
        return;
      }

      const service = new ROSLIB.Service({
        ros: ros,
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
   * Arms the drone motors, preparing for flight.
   *
   * **SAFETY WARNING**: Arming enables motors. Ensure:
   * - Propellers are clear of obstructions and people
   * - Drone is in safe location for takeoff
   * - All pre-flight checks are complete
   *
   * Service: `/{droneNamespace}/arm`
   * Type: `std_srvs/srv/Trigger`
   *
   * @public
   * @async
   * @param {string} droneNamespace - Drone namespace (e.g., 'drone1')
   * @returns {Promise<ServiceResponse>} Promise with success status and message
   * @throws {Error} If not connected or arming fails
   *
   * @example
   * ```typescript
   * try {
   *   const result = await serviceManager.callArmService('drone1');
   *   if (result.success) {
   *     console.log('Motors armed');
   *   } else {
   *     console.error('Arming rejected:', result.message);
   *   }
   * } catch (error) {
   *   console.error('Arm service failed:', error);
   * }
   * ```
   */
  async callArmService(droneNamespace: string): Promise<ServiceResponse> {
    return new Promise((resolve, reject) => {
      console.log('[TRACE] callArmService called for:', droneNamespace);
      console.log('[TRACE] ROS connected:', this.client.getConnectionStatus());

      const ros = this.client.getRos();
      if (!ros || !this.client.getConnectionStatus()) {
        reject(new Error('Not connected to rosbridge'));
        return;
      }

      const service = new ROSLIB.Service({
        ros: ros,
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
   * Disarms the drone motors, making them safe to approach.
   *
   * **SAFETY NOTE**: Disarm only when:
   * - Drone is on the ground
   * - Not in flight
   * - Safe to power down motors
   *
   * Service: `/{droneNamespace}/disarm`
   * Type: `std_srvs/srv/Trigger`
   *
   * @public
   * @async
   * @param {string} droneNamespace - Drone namespace (e.g., 'drone1')
   * @returns {Promise<ServiceResponse>} Promise with success status and message
   * @throws {Error} If not connected or disarming fails
   *
   * @example
   * ```typescript
   * const result = await serviceManager.callDisarmService('drone1');
   * console.log(result.message); // "Disarmed successfully"
   * ```
   */
  async callDisarmService(droneNamespace: string): Promise<ServiceResponse> {
    return new Promise((resolve, reject) => {
      const ros = this.client.getRos();
      if (!ros || !this.client.getConnectionStatus()) {
        reject(new Error('Not connected to rosbridge'));
        return;
      }

      const service = new ROSLIB.Service({
        ros: ros,
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
   * Enables offboard flight mode for autonomous control.
   *
   * Offboard mode allows external position/velocity commands to control the drone.
   * Required for programmatic flight control via setpoints.
   *
   * **Prerequisites**:
   * - Drone must be armed
   * - Valid position estimate (GPS or local)
   * - Offboard setpoints being published
   *
   * Service: `/{droneNamespace}/set_offboard`
   * Type: `std_srvs/srv/Trigger`
   *
   * @public
   * @async
   * @param {string} droneNamespace - Drone namespace (e.g., 'drone1')
   * @returns {Promise<ServiceResponse>} Promise with success status and message
   * @throws {Error} If not connected or mode change fails
   *
   * @example
   * ```typescript
   * // Arm first
   * await serviceManager.callArmService('drone1');
   *
   * // Enable offboard mode
   * const result = await serviceManager.callSetOffboardService('drone1');
   * if (result.success) {
   *   console.log('Offboard mode enabled - drone ready for commands');
   * }
   * ```
   */
  async callSetOffboardService(droneNamespace: string): Promise<ServiceResponse> {
    return new Promise((resolve, reject) => {
      const ros = this.client.getRos();
      if (!ros || !this.client.getConnectionStatus()) {
        reject(new Error('Not connected to rosbridge'));
        return;
      }

      const service = new ROSLIB.Service({
        ros: ros,
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
}
