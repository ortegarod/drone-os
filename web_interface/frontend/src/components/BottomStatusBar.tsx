import React from 'react';
import { DroneStatus } from '../types/drone';

interface BottomStatusBarProps {
  droneStatus: DroneStatus;
}

const BottomStatusBar: React.FC<BottomStatusBarProps> = ({ droneStatus }) => {
  return (
    <footer className="bottom-status-bar">
      <div className="status-bar-left">
      </div>

      <div className="status-bar-right">
        <span className={`status-item battery ${
          droneStatus.battery > 50 ? 'battery-good' :
          droneStatus.battery > 25 ? 'battery-warning' : 'battery-critical'
        }`}>
          🔋 {droneStatus.battery}%
        </span>
      </div>
    </footer>
  );
};

export default BottomStatusBar;
