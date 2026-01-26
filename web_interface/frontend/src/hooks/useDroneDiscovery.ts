import { useState, useEffect, useCallback } from 'react';
// @ts-ignore
import ROSLIB from 'roslib';
import { ros, isConnected } from '../ros';

export const useDroneDiscovery = (connected: boolean, currentDroneName: string, setTargetDrone: (name: string) => void) => {
  const [availableDrones, setAvailableDrones] = useState<string[]>([]);

  const discoverDrones = useCallback(async () => {
    if (!isConnected()) return;

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

      console.log('[useDroneDiscovery] Found drones:', drones);
      setAvailableDrones(drones);

      // Auto-select first drone if none selected
      if (drones.length > 0 && !currentDroneName) {
        console.log(`[useDroneDiscovery] Selecting first drone: ${drones[0]}`);
        setTargetDrone(drones[0]);
      } else if (drones.length > 0 && !drones.includes(currentDroneName)) {
        console.log(`[useDroneDiscovery] Current drone gone, switching to ${drones[0]}`);
        setTargetDrone(drones[0]);
      }
    }, (error: any) => {
      console.error('[useDroneDiscovery] Discovery error:', error);
    });
  }, [currentDroneName, setTargetDrone]);

  useEffect(() => {
    if (connected) {
      discoverDrones();
      const interval = setInterval(discoverDrones, 5000);
      return () => clearInterval(interval);
    }
  }, [connected, discoverDrones]);

  return { availableDrones };
};
