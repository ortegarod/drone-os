// @ts-ignore
import ROSLIB from 'roslib';
import { ros, isConnected } from '../ros';

export interface DroneAPIConfig {
  droneName: string;
  onRefreshState: () => void;
  onSetTargetDrone?: (droneName: string) => void;
}

// Helper to call a Trigger service (arm, disarm, takeoff, land, etc.)
const callTriggerService = (droneName: string, serviceSuffix: string): Promise<{ success: boolean; message: string }> => {
  if (!isConnected()) {
    return Promise.reject(new Error('Not connected to rosbridge'));
  }

  return new Promise((resolve, reject) => {
    const service = new ROSLIB.Service({
      ros,
      name: `/${droneName}/${serviceSuffix}`,
      serviceType: 'std_srvs/srv/Trigger'
    });

    service.callService(new ROSLIB.ServiceRequest({}), (result: any) => {
      resolve({ success: result.success, message: result.message || '' });
    }, (error: any) => {
      reject(new Error(`${serviceSuffix} failed: ${error}`));
    });
  });
};

export const createDroneAPI = (config: DroneAPIConfig) => ({
  // Expose ros instance for components that need it (like MiniMap)
  ros,

  // Flight commands
  arm: () => callTriggerService(config.droneName, 'arm').then(r => { setTimeout(config.onRefreshState, 1000); return r; }),
  disarm: () => callTriggerService(config.droneName, 'disarm').then(r => { setTimeout(config.onRefreshState, 1000); return r; }),
  takeoff: () => callTriggerService(config.droneName, 'takeoff').then(r => { setTimeout(config.onRefreshState, 1000); return r; }),
  land: () => callTriggerService(config.droneName, 'land').then(r => { setTimeout(config.onRefreshState, 1000); return r; }),
  setOffboard: () => callTriggerService(config.droneName, 'set_offboard').then(r => { setTimeout(config.onRefreshState, 1000); return r; }),
  returnToLaunch: () => callTriggerService(config.droneName, 'return_to_launch').then(r => { setTimeout(config.onRefreshState, 1000); return r; }),
  flightTermination: () => Promise.resolve({ success: false, message: 'Termination not implemented' }),

  // Position control - the working implementation from commit 988e74f
  setPosition: (x: number, y: number, z: number, yaw: number): Promise<{ success: boolean; message: string }> => {
    if (!isConnected()) {
      return Promise.reject(new Error('Not connected to rosbridge'));
    }

    console.log('[droneAPI] setPosition:', { x, y, z, yaw, drone: config.droneName });

    return new Promise((resolve, reject) => {
      const service = new ROSLIB.Service({
        ros,
        name: `/${config.droneName}/set_position`,
        serviceType: 'drone_interfaces/srv/SetPosition'
      });

      service.callService(new ROSLIB.ServiceRequest({ x, y, z, yaw }), (result: any) => {
        console.log('[droneAPI] setPosition result:', result);
        resolve({ success: result.success, message: result.message || '' });
        setTimeout(config.onRefreshState, 1000);
      }, (error: any) => {
        console.error('[droneAPI] setPosition error:', error);
        reject(new Error(`SetPosition failed: ${error}`));
      });
    });
  },

  setPositionAutoYaw: (x: number, y: number, z: number): Promise<{ success: boolean; message: string }> => {
    // Just call setPosition with yaw=0, the drone will auto-yaw toward destination
    if (!isConnected()) {
      return Promise.reject(new Error('Not connected to rosbridge'));
    }

    return new Promise((resolve, reject) => {
      const service = new ROSLIB.Service({
        ros,
        name: `/${config.droneName}/set_position`,
        serviceType: 'drone_interfaces/srv/SetPosition'
      });

      service.callService(new ROSLIB.ServiceRequest({ x, y, z, yaw: 0 }), (result: any) => {
        resolve({ success: result.success, message: result.message || '' });
        setTimeout(config.onRefreshState, 1000);
      }, (error: any) => {
        reject(new Error(`SetPosition failed: ${error}`));
      });
    });
  },

  // Get drone state
  getState: (): Promise<{ success: boolean; message: string; state: any }> => {
    if (!isConnected()) {
      return Promise.reject(new Error('Not connected to rosbridge'));
    }

    return new Promise((resolve, reject) => {
      const service = new ROSLIB.Service({
        ros,
        name: `/${config.droneName}/get_state`,
        serviceType: 'drone_interfaces/srv/GetState'
      });

      service.callService(new ROSLIB.ServiceRequest({}), (result: any) => {
        resolve({ success: true, message: 'State retrieved', state: result });
      }, (error: any) => {
        reject(new Error(`GetState failed: ${error}`));
      });
    });
  },

  // Target management
  setTargetDrone: (drone_name: string) => {
    const old_target = config.droneName;
    if (config.onSetTargetDrone) {
      config.onSetTargetDrone(drone_name);
    }
    return Promise.resolve({ success: true, message: `Target changed from ${old_target} to ${drone_name}` });
  },

  // Discovery
  discoverDrones: (): Promise<string[]> => {
    if (!isConnected()) {
      return Promise.resolve([]);
    }

    return new Promise((resolve) => {
      const topicsClient = new ROSLIB.Service({
        ros,
        name: '/rosapi/topics',
        serviceType: 'rosapi/Topics'
      });

      topicsClient.callService(new ROSLIB.ServiceRequest({}), (result: any) => {
        const topics: string[] = result.topics || [];
        const drones = topics
          .filter((t: string) => t.endsWith('/drone_state'))
          .map((t: string) => t.split('/')[1])
          .filter((ns: string) => ns && ns.length > 0);
        console.log('[droneAPI] Discovered drones:', drones);
        resolve(drones);
      }, () => {
        resolve([]);
      });
    });
  },

  getNetwork: () => Promise.resolve({ services: [], target_drone: config.droneName }),
  getDroneServices: () => Promise.resolve({ target_drone: config.droneName, services: [] })
});
