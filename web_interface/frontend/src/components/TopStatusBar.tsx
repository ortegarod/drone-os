import React from 'react';
import { DroneStatus } from '../types/drone';

interface TopStatusBarProps {
  droneStatus: DroneStatus;
}

const TopStatusBar: React.FC<TopStatusBarProps> = ({ droneStatus }) => {
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
            ({droneStatus.position.x.toFixed(2)}, {droneStatus.position.y.toFixed(2)}, {Math.abs(droneStatus.position.z).toFixed(2)}) m
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
