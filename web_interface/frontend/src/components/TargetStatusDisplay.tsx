import React from 'react';
import { DroneStatus, UnitSystem } from '../App';

interface TargetStatusDisplayProps {
  droneStatus: DroneStatus;
  unitSystem: UnitSystem;
  convertDistance: (value: number, unit: UnitSystem) => number;
  getDistanceUnit: (unit: UnitSystem) => string;
}

const TargetStatusDisplay: React.FC<TargetStatusDisplayProps> = ({
  droneStatus,
  unitSystem,
  convertDistance,
  getDistanceUnit
}) => {
  return (
    <div style={{ 
      display: 'flex', 
      gap: '0.5rem', 
      marginBottom: '0.5rem',
      flexWrap: 'wrap'
    }}>
      <div className="status-section">
        <span className="status-label">Target:</span>
        <span className="status-value">{droneStatus.drone_name}</span>
      </div>
      <div className="status-section">
        <span className="status-label">Mode:</span>
        <span className="status-value">{droneStatus.flight_mode}</span>
      </div>
      <div className="status-section">
        <span className="status-label">Pos:</span>
        <span className="status-value">
          ({convertDistance(droneStatus.position.x, unitSystem).toFixed(1)}, {convertDistance(droneStatus.position.y, unitSystem).toFixed(1)}, {convertDistance(droneStatus.position.z, unitSystem).toFixed(1)}){getDistanceUnit(unitSystem)}
        </span>
      </div>
    </div>
  );
};

export default TargetStatusDisplay;