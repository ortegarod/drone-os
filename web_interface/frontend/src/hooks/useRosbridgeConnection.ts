import { useState, useEffect } from 'react';
import { rosbridgeClient } from '../services/rosbridgeClient';

/**
 * Custom hook to manage rosbridge connection state
 */
export const useRosbridgeConnection = (onConnected?: () => void) => {
  const [isConnected, setIsConnected] = useState(false);

  useEffect(() => {
    // Set up connection status callback
    const handleConnectionStatus = (connected: boolean) => {
      setIsConnected(connected);
      if (connected && onConnected) {
        onConnected();
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
      if (onConnected) {
        onConnected();
      }
    }

    // Cleanup on unmount
    return () => {
      rosbridgeClient.removeConnectionStatusCallback(handleConnectionStatus);
    };
  }, [onConnected]);

  return { isConnected };
};
