import { useState, useEffect, useCallback, useRef } from 'react';
// @ts-ignore
import ROSLIB from 'roslib';
import { ros, isConnected } from '../ros';
import { DroneStatus } from '../types/drone';

export const useDroneState = (connected: boolean) => {
  const [droneStatus, setDroneStatus] = useState<DroneStatus>({
    drone_name: '',
    connected: false,
    armed: false,
    flight_mode: 'UNKNOWN',
    position: { x: 0, y: 0, z: 0, yaw: 0 },
    battery: 0,
    timestamp: 0
  });

  const topicRef = useRef<any>(null);

  const refreshDroneState = useCallback(async () => {
    if (!isConnected() || !droneStatus.drone_name) return;

    const service = new ROSLIB.Service({
      ros,
      name: `/${droneStatus.drone_name}/get_state`,
      serviceType: 'drone_interfaces/srv/GetState'
    });

    service.callService(new ROSLIB.ServiceRequest({}), (result: any) => {
      if (result) {
        setDroneStatus(prev => ({
          drone_name: prev.drone_name,
          connected: true,
          armed: result.armed || false,
          flight_mode: result.flight_mode || 'UNKNOWN',
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
    }, (error: any) => {
      console.error('[useDroneState] get_state error:', error);
    });
  }, [droneStatus.drone_name]);

  // Subscribe to drone state topic
  useEffect(() => {
    if (!connected || !droneStatus.drone_name) return;

    // Cleanup previous subscription
    if (topicRef.current) {
      topicRef.current.unsubscribe();
    }

    console.log(`[useDroneState] Subscribing to /${droneStatus.drone_name}/drone_state`);

    const topic = new ROSLIB.Topic({
      ros,
      name: `/${droneStatus.drone_name}/drone_state`,
      messageType: 'drone_interfaces/DroneState',
      throttle_rate: 100
    });

    topic.subscribe((msg: any) => {
      setDroneStatus(prev => ({
        drone_name: prev.drone_name,
        connected: true,
        armed: msg.armed || false,
        flight_mode: msg.flight_mode || 'UNKNOWN',
        position: {
          x: msg.local_x || 0,
          y: msg.local_y || 0,
          z: msg.local_z || 0,
          yaw: msg.local_yaw || 0
        },
        battery: Math.round((msg.battery_remaining || 0) * 100),
        timestamp: Date.now()
      }));
    });

    topicRef.current = topic;

    return () => {
      if (topicRef.current) {
        topicRef.current.unsubscribe();
        topicRef.current = null;
      }
    };
  }, [connected, droneStatus.drone_name]);

  const setTargetDrone = useCallback((name: string) => {
    setDroneStatus(prev => ({ ...prev, drone_name: name }));
  }, []);

  return { droneStatus, refreshDroneState, setTargetDrone };
};
