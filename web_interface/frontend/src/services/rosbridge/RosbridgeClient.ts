/**
 * @fileoverview Core Rosbridge WebSocket connection manager.
 * Handles WebSocket lifecycle, automatic reconnection with exponential backoff,
 * and connection event broadcasting.
 *
 * @module rosbridge/RosbridgeClient
 */

import * as ROSLIB from 'roslib';
import { ConnectionOptions, ConnectionCallback, LogCallback } from './types';

/**
 * Manages WebSocket connection to ROS via rosbridge_suite.
 *
 * Provides:
 * - Automatic connection management with exponential backoff
 * - Connection status callbacks for reactive UI updates
 * - Shared ROSLIB.Ros instance for TopicManager and ServiceManager
 * - Configurable reconnection behavior
 *
 * @class RosbridgeClient
 *
 * @example
 * ```typescript
 * const client = new RosbridgeClient({
 *   url: 'ws://localhost:9090',
 *   reconnectInterval: 3000,
 *   maxReconnectAttempts: 10
 * });
 *
 * client.onConnectionStatusChanged((connected, error) => {
 *   console.log('Connected:', connected);
 * });
 *
 * client.connect();
 * ```
 */
export class RosbridgeClient {
  private ros: ROSLIB.Ros | null = null;
  private url: string;
  private reconnectInterval: number;
  private maxReconnectAttempts: number;
  private enableLogging: boolean;

  private reconnectAttempts = 0;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private isConnected = false;
  private shouldReconnect = true;

  // Event callbacks
  private connectionCallbacks: Set<ConnectionCallback> = new Set();
  private logCallbacks: Set<LogCallback> = new Set();

  /**
   * Creates a new RosbridgeClient instance.
   *
   * @param {ConnectionOptions} options - Configuration options
   * @param {string} [options.url='ws://localhost:9090'] - WebSocket URL
   * @param {number} [options.reconnectInterval=3000] - Reconnect interval in ms
   * @param {number} [options.maxReconnectAttempts=10] - Max reconnect attempts
   * @param {boolean} [options.enableLogging=true] - Enable console logging
   */
  constructor(options: ConnectionOptions = {}) {
    this.url = options.url || 'ws://localhost:9090';
    this.reconnectInterval = options.reconnectInterval || 3000;
    this.maxReconnectAttempts = options.maxReconnectAttempts || 10;
    this.enableLogging = options.enableLogging !== false;
  }

  /**
   * Initiates connection to rosbridge WebSocket server.
   *
   * If already connected, logs a warning and returns.
   * On failure, automatically schedules reconnection attempts with exponential backoff.
   *
   * @public
   * @returns {void}
   */
  connect(): void {
    if (this.isConnected) {
      this.log('warn', 'Already connected to rosbridge');
      return;
    }

    this.log('info', `Connecting to rosbridge at ${this.url}`);
    this.shouldReconnect = true;

    try {
      this.ros = new ROSLIB.Ros({
        url: this.url
      });

      this.setupRosHandlers();
    } catch (error) {
      this.log('error', `Failed to create ROS connection: ${error}`);
      this.scheduleReconnect();
    }
  }

  /**
   * Disconnects from rosbridge server and cleans up resources.
   *
   * Stops reconnection attempts, closes WebSocket, and resets connection state.
   * Notifies all registered callbacks of disconnection.
   *
   * @public
   * @returns {void}
   */
  disconnect(): void {
    this.shouldReconnect = false;
    this.clearTimers();

    if (this.ros) {
      this.ros.close();
      this.ros = null;
    }

    this.isConnected = false;
    this.reconnectAttempts = 0;
    this.notifyConnectionStatus(false);
  }

  /**
   * Returns the underlying ROSLIB.Ros instance.
   *
   * Used by TopicManager and ServiceManager to create topics/services.
   *
   * @public
   * @returns {ROSLIB.Ros | null} ROS instance or null if not connected
   */
  getRos(): ROSLIB.Ros | null {
    return this.ros;
  }

  /**
   * Returns current connection status.
   *
   * @public
   * @returns {boolean} True if connected, false otherwise
   */
  getConnectionStatus(): boolean {
    return this.isConnected;
  }

  /**
   * Registers a callback for connection status changes.
   *
   * Callback will be invoked whenever connection state changes (connected/disconnected).
   *
   * @public
   * @param {ConnectionCallback} callback - Function to call on status change
   * @returns {void}
   */
  onConnectionStatusChanged(callback: ConnectionCallback): void {
    this.connectionCallbacks.add(callback);
  }

  /**
   * Unregisters a connection status callback.
   *
   * @public
   * @param {ConnectionCallback} callback - Callback to remove
   * @returns {void}
   */
  removeConnectionStatusCallback(callback: ConnectionCallback): void {
    this.connectionCallbacks.delete(callback);
  }

  /**
   * Registers a callback for log messages.
   *
   * Allows external code to capture and display logs (e.g., in UI).
   *
   * @public
   * @param {LogCallback} callback - Function to call for log messages
   * @returns {void}
   */
  onLogMessage(callback: LogCallback): void {
    this.logCallbacks.add(callback);
  }

  /**
   * Unregisters a log message callback.
   *
   * @public
   * @param {LogCallback} callback - Callback to remove
   * @returns {void}
   */
  removeLogCallback(callback: LogCallback): void {
    this.logCallbacks.delete(callback);
  }

  /**
   * Sets up event handlers for ROSLIB.Ros WebSocket events.
   *
   * Handles: connection, error, close events.
   * Manages reconnection logic and connection status broadcasting.
   *
   * @private
   * @returns {void}
   */
  private setupRosHandlers(): void {
    if (!this.ros) return;

    this.ros.on('connection', () => {
      this.log('info', 'Connected to rosbridge server');
      this.isConnected = true;
      this.reconnectAttempts = 0;
      this.notifyConnectionStatus(true);
    });

    this.ros.on('error', (error: any) => {
      this.log('error', `ROS connection error: ${error}`);
      this.notifyConnectionStatus(false, 'ROS connection error occurred');
    });

    this.ros.on('close', () => {
      this.log('warn', 'ROS connection closed');
      this.isConnected = false;
      this.clearTimers();
      this.notifyConnectionStatus(false, 'Connection closed');

      if (this.shouldReconnect) {
        this.scheduleReconnect();
      }
    });
  }

  /**
   * Schedules a reconnection attempt with exponential backoff.
   *
   * Backoff is capped at 5x the base reconnect interval.
   * Stops attempting after maxReconnectAttempts is reached.
   *
   * @private
   * @returns {void}
   */
  private scheduleReconnect(): void {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      this.log('error', 'Max reconnection attempts reached. Giving up.');
      this.shouldReconnect = false;
      return;
    }

    this.reconnectAttempts++;
    const delay = this.reconnectInterval * Math.min(this.reconnectAttempts, 5); // Exponential backoff, capped

    this.log('info', `Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts})`);

    this.reconnectTimer = setTimeout(() => {
      if (this.shouldReconnect) {
        this.connect();
      }
    }, delay);
  }

  /**
   * Clears all active timers (reconnect).
   *
   * @private
   * @returns {void}
   */
  private clearTimers(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  /**
   * Notifies all registered connection callbacks of status change.
   *
   * Safely handles callback exceptions to prevent one failure from
   * affecting other callbacks.
   *
   * @private
   * @param {boolean} connected - Whether connection is established
   * @param {string} [error] - Optional error message
   * @returns {void}
   */
  private notifyConnectionStatus(connected: boolean, error?: string): void {
    this.connectionCallbacks.forEach(callback => {
      try {
        callback(connected, error);
      } catch (e) {
        this.log('error', `Error in connection callback: ${e}`);
      }
    });
  }

  /**
   * Internal logging method.
   *
   * Logs to console (if enabled) and broadcasts to log callbacks.
   *
   * @private
   * @param {'info' | 'warn' | 'error'} level - Log severity
   * @param {string} message - Log message
   * @returns {void}
   */
  private log(level: 'info' | 'warn' | 'error', message: string): void {
    if (this.enableLogging) {
      console[level](`[RosbridgeClient] ${message}`);
    }

    this.logCallbacks.forEach(callback => {
      try {
        callback(level, message);
      } catch (e) {
        console.error(`Error in log callback: ${e}`);
      }
    });
  }
}
