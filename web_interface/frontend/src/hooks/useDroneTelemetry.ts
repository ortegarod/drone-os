/**
 * React Hook for Drone Telemetry Management
 * 
 * This hook provides a clean interface for managing drone telemetry subscriptions
 * and handles connection state, error recovery, and data caching.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { rosbridgeClient, DroneState, ConnectionCallback } from '../services/rosbridgeClient';

export interface TelemetryState {
  droneState: DroneState | null;
  isConnected: boolean;
  isLoading: boolean;
  error: string | null;
  lastUpdate: Date | null;
  connectionAttempts: number;
}

export interface TelemetryOptions {
  droneNamespace?: string;
  autoConnect?: boolean;
  retryOnError?: boolean;
  cacheData?: boolean;
  updateThreshold?: number; // Minimum time between state updates in ms
}

export interface TelemetryActions {
  connect: () => void;
  disconnect: () => void;
  refreshState: () => Promise<void>;
  clearError: () => void;
  getConnectionStatus: () => boolean;
}

const DEFAULT_OPTIONS: Required<TelemetryOptions> = {
  droneNamespace: 'px4_1',
  autoConnect: true,
  retryOnError: true,
  cacheData: true,
  updateThreshold: 50 // 20Hz max update rate
};

export function useDroneTelemetry(
  options: TelemetryOptions = {}
): [TelemetryState, TelemetryActions] {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  
  // State management
  const [state, setState] = useState<TelemetryState>({
    droneState: null,
    isConnected: false,
    isLoading: false,
    error: null,
    lastUpdate: null,
    connectionAttempts: 0
  });

  // Refs for managing subscriptions and throttling
  const subscriptionIdRef = useRef<string | null>(null);
  const lastUpdateTimeRef = useRef<number>(0);
  const retryTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const stateCache = useRef<DroneState | null>(null);

  // Connection status handler with error recovery
  const handleConnectionStatus: ConnectionCallback = useCallback((connected, error) => {
    setState(prev => ({
      ...prev,
      isConnected: connected,
      isLoading: false,
      error: error || null,
      connectionAttempts: connected ? 0 : prev.connectionAttempts + 1
    }));

    // Auto-retry connection on failure
    if (!connected && opts.retryOnError && error) {
      const retryDelay = Math.min(5000, 1000 * Math.pow(2, state.connectionAttempts)); // Exponential backoff
      
      if (retryTimeoutRef.current) {
        clearTimeout(retryTimeoutRef.current);
      }
      
      retryTimeoutRef.current = setTimeout(() => {
        if (!rosbridgeClient.getConnectionStatus()) {
          rosbridgeClient.connect();
        }
      }, retryDelay);
    }
  }, [opts.retryOnError, state.connectionAttempts]);

  // Throttled drone state update handler
  const handleDroneStateUpdate = useCallback((newState: DroneState) => {
    const now = Date.now();
    
    // Throttle updates based on updateThreshold
    if (now - lastUpdateTimeRef.current < opts.updateThreshold) {
      return;
    }
    
    lastUpdateTimeRef.current = now;
    
    // Cache the state if enabled
    if (opts.cacheData) {
      stateCache.current = newState;
    }
    
    setState(prev => ({
      ...prev,
      droneState: newState,
      lastUpdate: new Date(),
      error: null // Clear any previous errors on successful update
    }));
  }, [opts.updateThreshold, opts.cacheData]);

  // Actions
  const connect = useCallback(() => {
    setState(prev => ({ ...prev, isLoading: true, error: null }));
    
    // Clear any pending retry timeouts
    if (retryTimeoutRef.current) {
      clearTimeout(retryTimeoutRef.current);
      retryTimeoutRef.current = null;
    }
    
    if (!rosbridgeClient.getConnectionStatus()) {
      rosbridgeClient.connect();
    } else {
      setState(prev => ({ ...prev, isLoading: false, isConnected: true }));
    }
  }, []);

  const disconnect = useCallback(() => {
    // Clear retry timeout
    if (retryTimeoutRef.current) {
      clearTimeout(retryTimeoutRef.current);
      retryTimeoutRef.current = null;
    }
    
    // Unsubscribe from drone state
    if (subscriptionIdRef.current) {
      rosbridgeClient.unsubscribeFromDroneState(subscriptionIdRef.current);
      subscriptionIdRef.current = null;
    }
    
    rosbridgeClient.disconnect();
    
    setState(prev => ({
      ...prev,
      isConnected: false,
      isLoading: false,
      connectionAttempts: 0
    }));
  }, []);

  const refreshState = useCallback(async (): Promise<void> => {
    if (!state.isConnected) {
      throw new Error('Not connected to telemetry service');
    }

    try {
      setState(prev => ({ ...prev, isLoading: true }));
      
      const serviceResponse = await rosbridgeClient.callGetStateService(opts.droneNamespace);
      
      // Convert service response to DroneState format
      const droneState: DroneState = {
        header: {
          stamp: { sec: Math.floor(Date.now() / 1000), nanosec: 0 },
          frame_id: 'base_link'
        },
        drone_name: opts.droneNamespace,
        ...serviceResponse
      };
      
      handleDroneStateUpdate(droneState);
      
    } catch (error) {
      setState(prev => ({
        ...prev,
        error: error instanceof Error ? error.message : 'Failed to refresh state',
        isLoading: false
      }));
      throw error;
    } finally {
      setState(prev => ({ ...prev, isLoading: false }));
    }
  }, [state.isConnected, opts.droneNamespace, handleDroneStateUpdate]);

  const clearError = useCallback(() => {
    setState(prev => ({ ...prev, error: null }));
  }, []);

  const getConnectionStatus = useCallback(() => {
    return rosbridgeClient.getConnectionStatus();
  }, []);

  // Setup connection and subscription
  useEffect(() => {
    // Add connection status listener
    rosbridgeClient.onConnectionStatusChanged(handleConnectionStatus);

    // Auto-connect if enabled
    if (opts.autoConnect) {
      connect();
    }

    return () => {
      // Cleanup on unmount
      if (retryTimeoutRef.current) {
        clearTimeout(retryTimeoutRef.current);
      }
      
      if (subscriptionIdRef.current) {
        rosbridgeClient.unsubscribeFromDroneState(subscriptionIdRef.current);
      }
      
      rosbridgeClient.removeConnectionStatusCallback(handleConnectionStatus);
    };
  }, [opts.autoConnect, handleConnectionStatus, connect]);

  // Manage drone state subscription
  useEffect(() => {
    if (state.isConnected && !subscriptionIdRef.current) {
      const subId = rosbridgeClient.subscribeToDroneState(
        opts.droneNamespace, 
        handleDroneStateUpdate
      );
      subscriptionIdRef.current = subId;
    } else if (!state.isConnected && subscriptionIdRef.current) {
      rosbridgeClient.unsubscribeFromDroneState(subscriptionIdRef.current);
      subscriptionIdRef.current = null;
    }
  }, [state.isConnected, opts.droneNamespace, handleDroneStateUpdate]);

  // Return cached state if available and connection is lost
  const finalState = {
    ...state,
    droneState: state.droneState || (opts.cacheData ? stateCache.current : null)
  };

  const actions: TelemetryActions = {
    connect,
    disconnect,
    refreshState,
    clearError,
    getConnectionStatus
  };

  return [finalState, actions];
}

// Additional utility hooks

/**
 * Hook for monitoring specific telemetry values with thresholds
 */
export function useTelemetryMonitor(
  droneState: DroneState | null,
  monitors: {
    batteryThreshold?: number;
    gpsMinSatellites?: number;
    maxFlightTime?: number;
    healthThreshold?: number;
  } = {}
) {
  const [alerts, setAlerts] = useState<{
    battery: boolean;
    gps: boolean;
    flightTime: boolean;
    health: boolean;
  }>({
    battery: false,
    gps: false,
    flightTime: false,
    health: false
  });

  useEffect(() => {
    if (!droneState) {
      setAlerts({ battery: false, gps: false, flightTime: false, health: false });
      return;
    }

    setAlerts({
      battery: monitors.batteryThreshold ? 
        droneState.battery_remaining < monitors.batteryThreshold : false,
      gps: monitors.gpsMinSatellites ? 
        droneState.gps_satellites_used < monitors.gpsMinSatellites : false,
      flightTime: monitors.maxFlightTime ? 
        droneState.flight_time_elapsed > monitors.maxFlightTime : false,
      health: monitors.healthThreshold ? 
        droneState.system_health_score < monitors.healthThreshold : false
    });
  }, [droneState, monitors]);

  return alerts;
}

/**
 * Hook for telemetry data history and trends
 */
export function useTelemetryHistory(
  droneState: DroneState | null,
  maxHistorySize: number = 100
) {
  const [history, setHistory] = useState<Array<{
    timestamp: Date;
    battery: number;
    altitude: number;
    health: number;
    gps_satellites: number;
  }>>([]);

  useEffect(() => {
    if (!droneState) return;

    const entry = {
      timestamp: new Date(),
      battery: droneState.battery_remaining,
      altitude: Math.abs(droneState.local_z),
      health: droneState.system_health_score,
      gps_satellites: droneState.gps_satellites_used
    };

    setHistory(prev => {
      const newHistory = [...prev, entry];
      return newHistory.slice(-maxHistorySize);
    });
  }, [droneState, maxHistorySize]);

  return history;
}