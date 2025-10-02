import React from 'react';
import { DroneStatus } from '../types/drone';

interface TargetStatusDisplayProps {
  droneStatus: DroneStatus;
}

const TargetStatusDisplay: React.FC<TargetStatusDisplayProps> = ({ droneStatus }) => {
  return (
    <div style={{
      display: 'flex',
      gap: '0.5rem',
      marginBottom: '0.5rem',
      flexWrap: 'wrap'
    }}>
      <div className="status-section">
        <span className="status-label">Target:</span>
        <span className="status-value">
          {droneStatus.drone_name || 'Discovering drones...'}
        </span>
      </div>
      <div className="status-section">
        <span className="status-label">Mode:</span>
        <span className="status-value">{droneStatus.flight_mode}</span>
      </div>
      <div className="status-section">
        <span className="status-label">Pos:</span>
        <span className="status-value">
          ({droneStatus.position.x.toFixed(1)}, {droneStatus.position.y.toFixed(1)}, {droneStatus.position.z.toFixed(1)})m
        </span>
      </div>
    </div>
  );
};

export default TargetStatusDisplay;