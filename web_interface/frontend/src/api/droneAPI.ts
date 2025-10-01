import { rosbridgeClient } from '../services/rosbridgeClient';

export interface DroneAPIConfig {
  droneName: string;
  onRefreshState: () => void;
  onSetTargetDrone?: (droneName: string) => void;
}

export const createDroneAPI = (config: DroneAPIConfig) => ({
  ros: null, // Keep null to indicate we're using rosbridgeClient instead of ROSLIB

  // Basic flight commands using our rosbridgeClient
  arm: async () => {
    console.log('[TRACE] ARM button clicked');
    const actualConnectionStatus = rosbridgeClient.getConnectionStatus();
    console.log('[TRACE] RosbridgeClient connected:', actualConnectionStatus);

    if (!actualConnectionStatus) {
      throw new Error('Not connected to drone control system');
    }

    try {
      console.log('[TRACE] Calling callArmService for drone:', config.droneName);
      const result = await rosbridgeClient.callArmService(config.droneName);
      console.log('[TRACE] ARM service result:', result);
      setTimeout(() => config.onRefreshState(), 1000);
      return {
        success: result.success,
        message: result.message || (result.success ? 'Command executed' : 'Command failed')
      };
    } catch (error) {
      console.error('[TRACE] ARM service error:', error);
      throw new Error(`Arm command failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  },

  disarm: async () => {
    const actualConnectionStatus = rosbridgeClient.getConnectionStatus();
    if (!actualConnectionStatus) throw new Error('Not connected to drone control system');
    try {
      const result = await rosbridgeClient.callDisarmService(config.droneName);
      setTimeout(() => config.onRefreshState(), 1000);
      return {
        success: result.success,
        message: result.message || (result.success ? 'Command executed' : 'Command failed')
      };
    } catch (error) {
      throw new Error(`Disarm command failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  },

  takeoff: () => Promise.resolve({ success: false, message: 'Use CLI or web interface for takeoff' }),
  land: () => Promise.resolve({ success: false, message: 'Use CLI or web interface for land' }),
  returnToLaunch: () => Promise.resolve({ success: false, message: 'Use CLI or web interface for RTL' }),
  flightTermination: () => Promise.resolve({ success: false, message: 'Use CLI or web interface for termination' }),

  setOffboard: async () => {
    const actualConnectionStatus = rosbridgeClient.getConnectionStatus();
    if (!actualConnectionStatus) throw new Error('Not connected to drone control system');
    try {
      const result = await rosbridgeClient.callSetOffboardService(config.droneName);
      setTimeout(() => config.onRefreshState(), 1000);
      return {
        success: result.success,
        message: result.message || (result.success ? 'Command executed' : 'Command failed')
      };
    } catch (error) {
      throw new Error(`Set offboard failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  },

  // Position control (placeholder)
  setPosition: (x: number, y: number, z: number, yaw: number) => {
    return Promise.resolve({ success: false, message: 'Use CLI or web interface for position control' });
  },

  setPositionAutoYaw: (x: number, y: number, z: number) => {
    return Promise.resolve({ success: false, message: 'Use CLI or web interface for position control' });
  },

  // Get drone state using rosbridgeClient
  getState: () => {
    if (!rosbridgeClient.getConnectionStatus()) {
      return Promise.reject(new Error('Not connected to rosbridge'));
    }
    return rosbridgeClient.callGetStateService(config.droneName);
  },

  // Target management
  setTargetDrone: (drone_name: string) => {
    const old_target = config.droneName;
    if (config.onSetTargetDrone) {
      config.onSetTargetDrone(drone_name);
    }
    return Promise.resolve({
      success: true,
      message: `Target changed from ${old_target} to ${drone_name}`,
      old_target,
      new_target: drone_name
    });
  },

  // Simplified network/drone discovery
  getNetwork: () => {
    return Promise.resolve({
      services: [],
      target_drone: config.droneName
    });
  },

  getDroneServices: () => {
    return Promise.resolve({
      target_drone: config.droneName,
      services: []
    });
  },

  discoverDrones: () => {
    // Return default drone list
    return Promise.resolve(['drone1']);
  }
});
