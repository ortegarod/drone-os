import React from 'react';
import { DroneStatus } from '../types/drone';
import { UnitSystem, convertDistance, getDistanceUnit } from '../utils/unitConversions';

interface TopStatusBarProps {
  droneStatus: DroneStatus;
  unitSystem: UnitSystem;
}

const TopStatusBar: React.FC<TopStatusBarProps> = ({ droneStatus, unitSystem }) => {
  return (
    <div className="top-status-bar">
      <div className="status-row">
        <div className="status-section">
          <span className="status-label">Last Update:</span>
          <span className="status-value">
            {droneStatus.timestamp ? new Date(droneStatus.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : 'NEVER'}
          </span>
        </div>

        <div className="status-section">
          <span className="status-label">Connection:</span>
          <span className={`status-value ${droneStatus.connected ? 'status-connected' : 'status-disconnected'}`}>
            {droneStatus.connected ? 'ACTIVE' : 'INACTIVE'}
          </span>
        </div>

        <div className="status-section">
          <span className="status-label">Armed:</span>
          <span className={`status-value ${droneStatus.armed ? 'status-armed' : 'status-disarmed'}`}>
            {droneStatus.armed ? 'ARMED' : 'DISARMED'}
          </span>
        </div>

        <div className="status-section">
          <span className="status-label">Mode:</span>
          <span className="status-value">{droneStatus.flight_mode}</span>
        </div>

        <div className="status-section">
          <span className="status-label">Position:</span>
          <span className="status-value">
            ({convertDistance(droneStatus.position.x, unitSystem).toFixed(2)}, {convertDistance(droneStatus.position.y, unitSystem).toFixed(2)}, {convertDistance(Math.abs(droneStatus.position.z), unitSystem).toFixed(2)}) {getDistanceUnit(unitSystem)}
          </span>
        </div>

        <div className="status-section">
          <span className="status-label">Heading:</span>
          <span className="status-value">{droneStatus.position.yaw.toFixed(2)} RAD</span>
        </div>
      </div>
    </div>
  );
};

export default TopStatusBar;
