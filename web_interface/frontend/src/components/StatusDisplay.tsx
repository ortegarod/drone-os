import React from 'react';
import { DroneStatus } from '../App';

interface StatusDisplayProps {
  droneStatus: DroneStatus;
  isConnected: boolean;
}

const StatusDisplay: React.FC<StatusDisplayProps> = ({ droneStatus, isConnected }) => {
  const formatTimestamp = (timestamp: number) => {
    return new Date(timestamp * 1000).toLocaleTimeString();
  };

  const getAltitudeText = (z: number) => {
    const altitude = -z; // Convert NED to altitude
    return `${altitude.toFixed(1)}m`;
  };

  return (
    <div>
      <h2>Map View</h2>
      
      {/* Visual Position Indicator */}
      <div>
        <h3>Position Visualization</h3>
        <div style={{
          width: '200px',
          height: '200px',
          backgroundColor: '#3d3d3d',
          border: '1px solid #555',
          borderRadius: '4px',
          position: 'relative',
          margin: '0 auto'
        }}>
          {/* Center crosshair */}
          <div style={{
            position: 'absolute',
            top: '50%',
            left: '50%',
            width: '2px',
            height: '20px',
            backgroundColor: '#666',
            transform: 'translate(-50%, -50%)'
          }} />
          <div style={{
            position: 'absolute',
            top: '50%',
            left: '50%',
            width: '20px',
            height: '2px',
            backgroundColor: '#666',
            transform: 'translate(-50%, -50%)'
          }} />
          
          {/* Drone position indicator */}
          <div style={{
            position: 'absolute',
            top: `${50 - (droneStatus.position.x * 2)}%`, // Scale and invert Y for display
            left: `${50 + (droneStatus.position.y * 2)}%`, // Scale X
            width: '8px',
            height: '8px',
            backgroundColor: droneStatus.armed ? '#ff4444' : '#00ff88',
            borderRadius: '50%',
            transform: 'translate(-50%, -50%)',
            zIndex: 10
          }} />
          
          {/* Compass labels */}
          <div style={{
            position: 'absolute',
            top: '5px',
            left: '50%',
            transform: 'translateX(-50%)',
            fontSize: '10px',
            color: '#888'
          }}>N</div>
          <div style={{
            position: 'absolute',
            bottom: '5px',
            left: '50%',
            transform: 'translateX(-50%)',
            fontSize: '10px',
            color: '#888'
          }}>S</div>
          <div style={{
            position: 'absolute',
            top: '50%',
            right: '5px',
            transform: 'translateY(-50%)',
            fontSize: '10px',
            color: '#888'
          }}>E</div>
          <div style={{
            position: 'absolute',
            top: '50%',
            left: '5px',
            transform: 'translateY(-50%)',
            fontSize: '10px',
            color: '#888'
          }}>W</div>
        </div>
        <div style={{ 
          textAlign: 'center', 
          marginTop: '0.5rem', 
          fontSize: '0.75rem', 
          color: '#888' 
        }}>
          Scale: 1 unit = 50cm
        </div>
      </div>
    </div>
  );
};

export default StatusDisplay;