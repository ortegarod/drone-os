/**
 * Real-time Status Bar Component for Drone Telemetry
 * 
 * This component displays live drone status information received through rosbridge WebSocket connection.
 * It shows critical telemetry data in a compact status bar format suitable for the bottom of the interface.
 */

import React, { useEffect, useState, useCallback } from 'react';
import { rosbridgeClient, DroneState } from '../services/rosbridgeClient';

interface StatusBarProps {
  droneNamespace?: string;
  className?: string;
  showDetailedStatus?: boolean;
}

interface ConnectionStatus {
  connected: boolean;
  error?: string;
  lastUpdate?: Date;
}

interface StatusIndicatorProps {
  label: string;
  value: string | number;
  unit?: string;
  status: 'good' | 'warning' | 'critical' | 'unknown';
  className?: string;
}

const StatusIndicator: React.FC<StatusIndicatorProps> = ({ 
  label, 
  value, 
  unit = '', 
  status, 
  className = '' 
}) => {
  const statusColors = {
    good: 'text-green-400 bg-green-900/20',
    warning: 'text-yellow-400 bg-yellow-900/20',
    critical: 'text-red-400 bg-red-900/20',
    unknown: 'text-gray-400 bg-gray-800/20'
  };

  const displayValue = typeof value === 'number' ? 
    (Math.abs(value) >= 1000 ? value.toFixed(0) : value.toFixed(1)) : 
    value;

  return (
    <div className={`px-3 py-1 rounded-md border transition-colors duration-200 ${statusColors[status]} ${className}`}>
      <div className="text-xs font-medium opacity-75">{label}</div>
      <div className="text-sm font-bold">
        {displayValue}{unit}
      </div>
    </div>
  );
};

const ConnectionIndicator: React.FC<{ status: ConnectionStatus }> = ({ status }) => {
  const indicatorColor = status.connected ? 'bg-green-500' : 'bg-red-500';
  const pulseClass = status.connected ? 'animate-pulse' : '';
  
  return (
    <div className="flex items-center space-x-2">
      <div className={`w-2 h-2 rounded-full ${indicatorColor} ${pulseClass}`}></div>
      <span className="text-xs text-gray-300">
        {status.connected ? 'Live' : 'Disconnected'}
      </span>
      {status.lastUpdate && (
        <span className="text-xs text-gray-500">
          {status.lastUpdate.toLocaleTimeString()}
        </span>
      )}
    </div>
  );
};

export const RealTimeStatusBar: React.FC<StatusBarProps> = ({
  droneNamespace = 'px4_1',
  className = '',
  showDetailedStatus = false
}) => {
  const [droneState, setDroneState] = useState<DroneState | null>(null);
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>({
    connected: false
  });
  const [subscriptionId] = useState<string | null>(null);

  // Connection status handler
  const handleConnectionStatus = useCallback((connected: boolean, error?: string) => {
    setConnectionStatus(prev => ({
      ...prev,
      connected,
      error,
      lastUpdate: connected ? new Date() : prev.lastUpdate
    }));
  }, []);

  // Drone state update handler
  const handleDroneStateUpdate = useCallback((state: DroneState) => {
    setDroneState(state);
    setConnectionStatus(prev => ({
      ...prev,
      lastUpdate: new Date()
    }));
  }, []);

  // Initialize rosbridge connection and subscription
  useEffect(() => {
    // Add connection status listener
    rosbridgeClient.onConnectionStatusChanged(handleConnectionStatus);

    // Connect if not already connected
    if (!rosbridgeClient.getConnectionStatus()) {
      rosbridgeClient.connect();
    }

    // Subscribe to drone state
    const subId = rosbridgeClient.subscribeToDroneState(droneNamespace, handleDroneStateUpdate);

    return () => {
      // Cleanup on unmount
      if (subId) {
        rosbridgeClient.unsubscribeFromDroneState(subId);
      }
      rosbridgeClient.removeConnectionStatusCallback(handleConnectionStatus);
    };
  }, [droneNamespace, handleConnectionStatus, handleDroneStateUpdate]);

  // Helper functions for status determination
  const getBatteryStatus = (remaining: number, warning: string): 'good' | 'warning' | 'critical' => {
    if (warning === 'CRITICAL' || warning === 'EMERGENCY') return 'critical';
    if (warning === 'LOW' || remaining < 0.25) return 'warning';
    return 'good';
  };

  const getGPSStatus = (fixType: string, satellites: number): 'good' | 'warning' | 'critical' => {
    if (fixType === 'NONE' || satellites < 4) return 'critical';
    if (fixType === '2D' || satellites < 6) return 'warning';
    return 'good';
  };

  const getArmingStatus = (armingState: string): 'good' | 'warning' | 'critical' => {
    if (armingState === 'ARMED') return 'good';
    if (armingState === 'DISARMED') return 'warning';
    return 'critical';
  };

  const getHealthStatus = (score: number): 'good' | 'warning' | 'critical' => {
    if (score >= 80) return 'good';
    if (score >= 60) return 'warning';
    return 'critical';
  };

  const formatPosition = (x: number, y: number, z: number): string => {
    return `${x.toFixed(1)}, ${y.toFixed(1)}, ${Math.abs(z).toFixed(1)}m`;
  };

  const formatFlightTime = (seconds: number): string => {
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`;
  };

  if (!connectionStatus.connected) {
    return (
      <div className={`bg-gray-900 border-t border-gray-700 px-4 py-2 ${className}`}>
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-4">
            <ConnectionIndicator status={connectionStatus} />
            <span className="text-sm text-red-400">
              {connectionStatus.error || 'Connecting to telemetry...'}
            </span>
          </div>
          <div className="text-xs text-gray-500">
            Drone: {droneNamespace}
          </div>
        </div>
      </div>
    );
  }

  if (!droneState) {
    return (
      <div className={`bg-gray-900 border-t border-gray-700 px-4 py-2 ${className}`}>
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-4">
            <ConnectionIndicator status={connectionStatus} />
            <span className="text-sm text-yellow-400">Waiting for telemetry data...</span>
          </div>
          <div className="text-xs text-gray-500">
            Drone: {droneNamespace}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={`bg-gray-900 border-t border-gray-700 px-4 py-2 ${className}`}>
      <div className="flex items-center justify-between space-x-4">
        {/* Left side - Primary status indicators */}
        <div className="flex items-center space-x-3">
          <ConnectionIndicator status={connectionStatus} />
          
          <StatusIndicator
            label="Battery"
            value={Math.round(droneState.battery_remaining * 100)}
            unit="%"
            status={getBatteryStatus(droneState.battery_remaining, droneState.battery_warning)}
          />
          
          <StatusIndicator
            label="GPS"
            value={`${droneState.gps_fix_type}(${droneState.gps_satellites_used})`}
            status={getGPSStatus(droneState.gps_fix_type, droneState.gps_satellites_used)}
          />
          
          <StatusIndicator
            label="Mode"
            value={droneState.nav_state}
            status={droneState.nav_state === 'OFFBOARD' ? 'good' : 'warning'}
          />
          
          <StatusIndicator
            label="Armed"
            value={droneState.arming_state}
            status={getArmingStatus(droneState.arming_state)}
          />
        </div>

        {/* Center - Position and flight info */}
        <div className="flex items-center space-x-3">
          <StatusIndicator
            label="Position"
            value={formatPosition(droneState.local_x, droneState.local_y, droneState.local_z)}
            status={droneState.position_valid ? 'good' : 'critical'}
          />
          
          <StatusIndicator
            label="Flight Time"
            value={formatFlightTime(droneState.flight_time_elapsed)}
            status="good"
          />
          
          {showDetailedStatus && (
            <>
              <StatusIndicator
                label="Health"
                value={Math.round(droneState.system_health_score)}
                unit="%"
                status={getHealthStatus(droneState.system_health_score)}
              />
              
              <StatusIndicator
                label="Link"
                value={Math.round(droneState.telemetry_link_quality)}
                unit="%"
                status={droneState.telemetry_link_quality > 80 ? 'good' : 
                       droneState.telemetry_link_quality > 50 ? 'warning' : 'critical'}
              />
            </>
          )}
        </div>

        {/* Right side - Warnings and drone info */}
        <div className="flex items-center space-x-3">
          {droneState.critical_failures.length > 0 && (
            <div className="flex items-center space-x-1 text-red-400">
              <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
              </svg>
              <span className="text-xs font-medium">{droneState.critical_failures.length}</span>
            </div>
          )}
          
          {droneState.active_warnings.length > 0 && (
            <div className="flex items-center space-x-1 text-yellow-400">
              <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
              </svg>
              <span className="text-xs font-medium">{droneState.active_warnings.length}</span>
            </div>
          )}
          
          <div className="text-xs text-gray-500">
            {droneState.drone_name}
          </div>
        </div>
      </div>
      
      {/* Detailed warnings display (when expanded) */}
      {showDetailedStatus && (droneState.critical_failures.length > 0 || droneState.active_warnings.length > 0) && (
        <div className="mt-2 pt-2 border-t border-gray-700">
          {droneState.critical_failures.map((failure, index) => (
            <div key={`critical-${index}`} className="text-xs text-red-400 mb-1">
              🚨 {failure}
            </div>
          ))}
          {droneState.active_warnings.map((warning, index) => (
            <div key={`warning-${index}`} className="text-xs text-yellow-400 mb-1">
              ⚠️ {warning}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default RealTimeStatusBar;