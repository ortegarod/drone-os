import React, { useState } from 'react';
import { DroneStatus } from '../types/drone';
import './DroneMenu.css';

interface DroneMenuProps {
  droneAPI: any;
  droneStatus: DroneStatus;
  availableDrones: string[];
  isConnected: boolean;
  targetAltitude: number;
  setTargetAltitude: (alt: number) => void;
  maxAltitude: number;
  setMaxAltitude: (max: number) => void;
}

const DroneMenu: React.FC<DroneMenuProps> = ({
  droneAPI, droneStatus, availableDrones, isConnected,
  targetAltitude, setTargetAltitude, maxAltitude, setMaxAltitude
}) => {
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');

  const runCommand = async (cmd: () => Promise<any>, name: string) => {
    setLoading(true);
    try {
      const result = await cmd();
      setMessage(`${name}: ${result.success ? 'OK' : 'Failed'}`);
    } catch (e: any) {
      setMessage(`${name}: ${e.message}`);
    }
    setLoading(false);
    setTimeout(() => setMessage(''), 3000);
  };

  return (
    <div className="drone-menu">
      {/* Flight Commands */}
      <div className="menu-section">
        <h3>Flight</h3>
        <div className="button-grid">
          <button onClick={() => runCommand(() => droneAPI.setOffboard(), 'Offboard')} disabled={loading}>
            OFFBOARD
          </button>
          <button className="btn-warning" onClick={() => runCommand(() => droneAPI.arm(), 'Arm')} disabled={droneStatus.armed || loading}>
            ARM
          </button>
          <button className="btn-success" onClick={() => runCommand(() => droneAPI.takeoff(), 'Takeoff')} disabled={!droneStatus.armed || loading}>
            TAKEOFF
          </button>
          <button onClick={() => runCommand(() => droneAPI.land(), 'Land')} disabled={!droneStatus.armed || loading}>
            LAND
          </button>
          <button onClick={() => runCommand(() => droneAPI.disarm(), 'Disarm')} disabled={!droneStatus.armed || loading}>
            DISARM
          </button>
          <button className="btn-danger" onClick={() => runCommand(() => droneAPI.flightTermination(), 'E-Stop')} disabled={loading}>
            E-STOP
          </button>
        </div>
      </div>

      {/* Altitude */}
      <div className="menu-section">
        <h3>Click Altitude: {targetAltitude}m</h3>
        <input
          type="range"
          className="altitude-slider"
          min="1"
          max={maxAltitude}
          value={targetAltitude}
          onChange={(e) => setTargetAltitude(parseInt(e.target.value))}
        />
        <div className="button-row">
          <button onClick={() => runCommand(() => droneAPI.setPosition(0, 0, -5, 0), 'Alt')} disabled={loading}>5m</button>
          <button onClick={() => runCommand(() => droneAPI.setPosition(0, 0, -10, 0), 'Alt')} disabled={loading}>10m</button>
          <button onClick={() => runCommand(() => droneAPI.setPosition(0, 0, -15, 0), 'Alt')} disabled={loading}>15m</button>
        </div>
      </div>

      {/* Drone switch (only if multiple) */}
      {availableDrones.length > 1 && (
        <div className="menu-section">
          <h3>Switch Drone</h3>
          {availableDrones.filter(d => d !== droneStatus.drone_name).map(drone => (
            <button key={drone} className="drone-select-btn" onClick={() => droneAPI.setTargetDrone(drone)}>
              {drone}
            </button>
          ))}
        </div>
      )}

      {message && <div className="status-message">{message}</div>}
    </div>
  );
};

export default DroneMenu;
