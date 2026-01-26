// Simple ROSLIB connection
// @ts-ignore
import ROSLIB from 'roslib';

const SERVER_HOST = process.env.REACT_APP_SERVER_HOST || 'localhost';
const ROSBRIDGE_URL = `ws://${SERVER_HOST}:9090`;

// Connection state
let connected = false;
const callbacks: ((c: boolean) => void)[] = [];

// Create ros instance
export let ros = new ROSLIB.Ros({ url: ROSBRIDGE_URL });

const setupHandlers = () => {
  ros.on('connection', () => {
    console.log('[ROS] Connected to', ROSBRIDGE_URL);
    connected = true;
    callbacks.forEach(cb => cb(true));
  });

  ros.on('error', (err: any) => {
    console.error('[ROS] Error:', err);
  });

  ros.on('close', () => {
    console.log('[ROS] Disconnected, reconnecting in 3s...');
    connected = false;
    callbacks.forEach(cb => cb(false));
    setTimeout(() => {
      // Create new instance for reconnect
      ros = new ROSLIB.Ros({ url: ROSBRIDGE_URL });
      setupHandlers();
    }, 3000);
  });
};

setupHandlers();

export const isConnected = () => connected;

export const onConnection = (cb: (c: boolean) => void) => {
  callbacks.push(cb);
  cb(connected);
  return () => { const i = callbacks.indexOf(cb); if (i >= 0) callbacks.splice(i, 1); };
};
