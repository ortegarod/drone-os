import { useState, useEffect, useCallback } from 'react';
import { rosbridgeClient } from '../services/rosbridgeClient';
import { DroneStatus } from '../types/drone';

/**
 * Custom hook to manage drone state and subscriptions
 */
export const useDroneState = (isConnected: boolean) => {
  const [droneStatus, setDroneStatus] = useState<DroneStatus>({
    drone_name: 'drone1',
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

  // Function to start subscription to drone state
  const startDroneStateSubscription = useCallback(() => {
    // Clear any existing subscription
    if (droneStateSub) {
      rosbridgeClient.unsubscribeFromDroneState(droneStateSub);
    }

    // Subscribe to drone state updates
    const subscriptionId = rosbridgeClient.subscribeToDroneState(
      droneStatus.drone_name,
      (state) => {
        setDroneStatus(prev => ({
          ...prev,
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
  }, [droneStatus.drone_name, droneStateSub]);

  // Handle drone name changes - restart subscription for new drone
  useEffect(() => {
    if (isConnected) {
      startDroneStateSubscription();
    }
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
