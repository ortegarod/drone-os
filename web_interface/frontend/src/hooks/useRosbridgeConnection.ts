import { useState, useEffect, useRef } from 'react';
import { rosbridgeClient } from '../services/rosbridgeClient';

/**
 * Custom hook to manage rosbridge connection state
 */
export const useRosbridgeConnection = (onConnected?: () => void) => {
  const [isConnected, setIsConnected] = useState(false);
  const onConnectedRef = useRef(onConnected);

  // Update ref when callback changes
  useEffect(() => {
    onConnectedRef.current = onConnected;
  }, [onConnected]);

  useEffect(() => {
    // Set up connection status callback
    const handleConnectionStatus = (connected: boolean) => {
      setIsConnected(connected);
      if (connected && onConnectedRef.current) {
        onConnectedRef.current();
      }
    };

    // Register connection callback
    rosbridgeClient.onConnectionStatusChanged(handleConnectionStatus);

    // Check current connection status and connect if needed
    const currentStatus = rosbridgeClient.getConnectionStatus();
    if (!currentStatus) {
      rosbridgeClient.connect();
    } else {
      setIsConnected(true);
      if (onConnectedRef.current) {
        onConnectedRef.current();
      }
    }

    // Cleanup on unmount
    return () => {
      rosbridgeClient.removeConnectionStatusCallback(handleConnectionStatus);
    };
  }, []); // Empty deps - only run once

  return { isConnected };
};
