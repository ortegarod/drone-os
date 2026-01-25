// ROS Bridge WebSocket configuration
// Uses REACT_APP_SERVER_HOST from .env (same host as camera, etc.)
const SERVER_HOST = process.env.REACT_APP_SERVER_HOST || 'localhost';
const ROSBRIDGE_PORT = '9090';
export const ROSBRIDGE_URL = `ws://${SERVER_HOST}:${ROSBRIDGE_PORT}`;
