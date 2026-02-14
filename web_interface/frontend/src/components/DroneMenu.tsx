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
  droneAPI, droneStatus,
  targetAltitude, setTargetAltitude, maxAltitude
}) => {
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');

  const run = async (cmd: () => Promise<any>, name: string) => {
    setLoading(true);
    try {
      const r = await cmd();
      setMessage(`${name}: ${r.success ? 'OK' : 'Failed'}`);
    } catch (e: any) {
      setMessage(`${name}: ${e.message}`);
    }
    setLoading(false);
    setTimeout(() => setMessage(''), 3000);
  };

  return (
    <div className="drone-menu">
      <div className="menu-section" style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 10px' }}>
        <span style={{ font: '10px monospace', color: '#8b949e', whiteSpace: 'nowrap' }}>ALT {targetAltitude}m</span>
        <input type="range" className="altitude-slider" min="1" max={maxAltitude} value={targetAltitude}
          onChange={(e) => setTargetAltitude(parseInt(e.target.value))} style={{ margin: 0 }} />
      </div>
      <div className="menu-section">
        <div className="button-grid">
          <div className="button-row">
            <button onClick={() => run(() => droneAPI.setOffboard(), 'Offboard')} disabled={loading}>OFFBOARD</button>
            <button className="btn-warning" onClick={() => run(() => droneAPI.arm(), 'Arm')} disabled={droneStatus.armed || loading}>ARM</button>
            <button className="btn-success" onClick={() => run(() => droneAPI.takeoff(), 'Takeoff')} disabled={!droneStatus.armed || loading}>TAKEOFF</button>
          </div>
          <div className="button-row">
            <button onClick={() => run(() => droneAPI.land(), 'Land')} disabled={!droneStatus.armed || loading}>LAND</button>
            <button onClick={() => run(() => droneAPI.returnToLaunch(), 'RTL')} disabled={!droneStatus.armed || loading}>RTL</button>
            <button onClick={() => run(() => droneAPI.disarm(), 'Disarm')} disabled={!droneStatus.armed || loading}>DISARM</button>
          </div>
          <div className="button-row">
            <button className="btn-danger" onClick={() => run(() => droneAPI.flightTermination(), 'E-Stop')} disabled={loading}>E-STOP</button>
          </div>
        </div>
      </div>
      {message && <div className="status-message">{message}</div>}
    </div>
  );
};

export default DroneMenu;
