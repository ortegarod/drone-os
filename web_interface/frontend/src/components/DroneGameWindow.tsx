import React from 'react';
import DroneViewer3D from './DroneViewer3D';
import CameraOverlay from './CameraOverlay';
import { DroneStatus } from '../types/drone';

interface DroneGameWindowProps {
  droneAPI: any;
  isConnected: boolean;
  droneStatus: DroneStatus;
}

const DroneGameWindow: React.FC<DroneGameWindowProps> = ({ droneAPI, isConnected, droneStatus }) => {
  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      {/* Status bar */}
      <div style={{
        backgroundColor: '#1a1a1a',
        borderBottom: '1px solid #333',
        padding: '4px 12px',
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        flexShrink: 0,
      }}>
        <span style={{
          fontSize: 11,
          fontWeight: 600,
          color: '#666',
          fontFamily: 'monospace',
          textTransform: 'uppercase' as const,
          letterSpacing: 1,
        }}>
          3D View
        </span>
        <span style={{
          fontSize: 10,
          fontFamily: 'monospace',
          color: isConnected ? '#00ff88' : '#ff4444',
        }}>
          {isConnected ? 'LIVE' : 'OFFLINE'}
        </span>
        <span style={{
          fontSize: 10,
          fontFamily: 'monospace',
          color: '#555',
          marginLeft: 'auto',
        }}>
          Alt: {Math.abs(droneStatus.position.z).toFixed(1)}m
        </span>
      </div>

      {/* 3D scene + camera overlay */}
      <div style={{ flex: 1, position: 'relative', minHeight: 0 }}>
        <DroneViewer3D droneStatus={droneStatus} isConnected={isConnected} />
        <CameraOverlay />
      </div>
    </div>
  );
};

export default DroneGameWindow;
