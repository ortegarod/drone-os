import { useState, useEffect } from 'react';
import { isConnected, onConnection } from '../ros';

export const useRosbridgeConnection = () => {
  const [connected, setConnected] = useState(isConnected());

  useEffect(() => {
    return onConnection(setConnected);
  }, []);

  return { isConnected: connected };
};
