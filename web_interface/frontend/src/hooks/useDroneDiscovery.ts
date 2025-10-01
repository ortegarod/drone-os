import { useState, useEffect, useCallback } from 'react';

/**
 * Custom hook to manage drone discovery
 */
export const useDroneDiscovery = (isConnected: boolean, currentDroneName: string, setTargetDrone: (name: string) => void) => {
  const [availableDrones, setAvailableDrones] = useState<string[]>([]);

  const discoverAvailableDrones = useCallback(async () => {
    try {
      // For now, set default drone - could be enhanced to discover dynamically via rosbridgeClient
      const discoveredDrones = ['drone1'];
      setAvailableDrones(discoveredDrones);

      // If current drone is not in discovered list, switch to first available
      if (discoveredDrones.length > 0 && !discoveredDrones.includes(currentDroneName)) {
        setTargetDrone(discoveredDrones[0]);
      }
    } catch (error) {
      console.warn('Drone discovery error:', error);
      setAvailableDrones(['drone1']);
    }
  }, [currentDroneName, setTargetDrone]);

  useEffect(() => {
    if (isConnected) {
      discoverAvailableDrones();
    }
  }, [isConnected, discoverAvailableDrones]);

  return { availableDrones };
};
