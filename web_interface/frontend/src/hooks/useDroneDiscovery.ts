import { useState, useEffect, useCallback } from 'react';
import { rosbridgeClient } from '../services/rosbridgeClient';

/**
 * Custom hook to manage dynamic drone discovery via ROS topics.
 *
 * Discovers drones by querying ROS for topics matching `/<namespace>/drone_state`.
 * Automatically switches to first discovered drone if current drone is unavailable.
 *
 * @param {boolean} isConnected - Whether rosbridge is connected
 * @param {string} currentDroneName - Currently selected drone namespace
 * @param {Function} setTargetDrone - Callback to change target drone
 * @returns {{ availableDrones: string[] }} List of discovered drone namespaces
 */
export const useDroneDiscovery = (isConnected: boolean, currentDroneName: string, setTargetDrone: (name: string) => void) => {
  const [availableDrones, setAvailableDrones] = useState<string[]>([]);

  const discoverAvailableDrones = useCallback(async () => {
    if (!isConnected) {
      console.log('[useDroneDiscovery] Not connected, skipping discovery');
      return;
    }

    try {
      console.log('[useDroneDiscovery] Starting drone discovery...');

      // Query ROS for all drone_state topics
      const discoveredDrones = await rosbridgeClient.discoverDrones();

      console.log('[useDroneDiscovery] Discovered drones:', discoveredDrones);
      setAvailableDrones(discoveredDrones);

      // If drones found and current drone is not in list, switch to first available
      if (discoveredDrones.length > 0 && currentDroneName && !discoveredDrones.includes(currentDroneName)) {
        console.log(`[useDroneDiscovery] Current drone '${currentDroneName}' not found, switching to '${discoveredDrones[0]}'`);
        setTargetDrone(discoveredDrones[0]);
      } else if (discoveredDrones.length > 0 && !currentDroneName) {
        // No current drone set, select first discovered
        console.log(`[useDroneDiscovery] No current drone, selecting '${discoveredDrones[0]}'`);
        setTargetDrone(discoveredDrones[0]);
      } else if (discoveredDrones.length === 0) {
        // No drones found - UI will show empty state
        console.warn('[useDroneDiscovery] No drones discovered in ROS');
      }
    } catch (error) {
      console.error('[useDroneDiscovery] Discovery error:', error);
      // Don't set fallback - let UI handle empty state
      setAvailableDrones([]);
    }
  }, [isConnected, currentDroneName, setTargetDrone]);

  useEffect(() => {
    if (isConnected) {
      // Initial discovery
      discoverAvailableDrones();

      // Periodic re-discovery (every 5 seconds) to detect new drones
      const intervalId = setInterval(() => {
        discoverAvailableDrones();
      }, 5000);

      return () => clearInterval(intervalId);
    }
  }, [isConnected, discoverAvailableDrones]);

  return { availableDrones };
};
