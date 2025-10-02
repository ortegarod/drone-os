import { useState, useEffect, useCallback } from 'react';
import { rosbridgeClient } from '../services/rosbridgeClient';
import { DroneStatus } from '../types/drone';

/**
 * Custom hook to manage drone state and subscriptions.
 *
 * Drone name is set dynamically by useDroneDiscovery when drones are discovered.
 * Initial state has empty drone_name until discovery completes.
 */
export const useDroneState = (isConnected: boolean) => {
  const [droneStatus, setDroneStatus] = useState<DroneStatus>({
    drone_name: '',  // Will be set by discovery
    connected: false,
    armed: false,
    flight_mode: 'UNKNOWN',
    position: { x: 0, y: 0, z: 0, yaw: 0 },
    battery: 0,
    timestamp: 0
  });

  const [droneStateSub, setDroneStateSub] = useState<string | null>(null);

  // Function to refresh drone state
  const refreshDroneState = useCallback(async () => {
    try {
      const result = await rosbridgeClient.callGetStateService(droneStatus.drone_name);
      if (result.success) {
        setDroneStatus(prev => ({
          ...prev,
          connected: true,
          armed: result.arming_state === 'ARMED',
          flight_mode: result.nav_state || 'UNKNOWN',
          position: {
            x: result.local_x || 0,
            y: result.local_y || 0,
            z: result.local_z || 0,
            yaw: result.local_yaw || 0
          },
          battery: Math.round((result.battery_remaining || 0) * 100),
          timestamp: Date.now()
        }));
      }
    } catch (error) {
      console.error('[DEBUG] Refresh state error:', error);
    }
  }, [droneStatus.drone_name]);

  // Handle drone name changes - restart subscription for new drone
  useEffect(() => {
    if (!isConnected || !droneStatus.drone_name) {
      return;
    }

    // Clear any existing subscription
    if (droneStateSub) {
      rosbridgeClient.unsubscribeFromDroneState(droneStateSub);
    }

    console.log(`[useDroneState] Subscribing to drone state for: ${droneStatus.drone_name}`);

    // Subscribe to drone state updates
    const subscriptionId = rosbridgeClient.subscribeToDroneState(
      droneStatus.drone_name,
      (state) => {
        console.log(`[useDroneState] Received state update for ${droneStatus.drone_name}:`, {
          armed: state.arming_state,
          mode: state.nav_state,
          battery: state.battery_remaining,
          pos_z: state.local_z
        });
        setDroneStatus(prev => ({
          ...prev,
          drone_name: droneStatus.drone_name, // Ensure drone_name stays set
          connected: true,
          armed: state.arming_state === 'ARMED',
          flight_mode: state.nav_state || 'UNKNOWN',
          position: {
            x: state.local_x || 0,
            y: state.local_y || 0,
            z: state.local_z || 0,
            yaw: state.local_yaw || 0
          },
          battery: Math.round((state.battery_remaining || 0) * 100),
          timestamp: Date.now()
        }));
      }
    );

    setDroneStateSub(subscriptionId);

    // Cleanup on unmount or when drone changes
    return () => {
      if (subscriptionId) {
        rosbridgeClient.unsubscribeFromDroneState(subscriptionId);
      }
    };
  }, [isConnected, droneStatus.drone_name]);

  // Function to set target drone
  const setTargetDrone = useCallback((droneName: string) => {
    setDroneStatus(prev => ({ ...prev, drone_name: droneName }));
  }, []);

  return {
    droneStatus,
    refreshDroneState,
    setTargetDrone
  };
};
