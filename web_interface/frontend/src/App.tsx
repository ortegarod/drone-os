import React, { useState } from 'react';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import TelemetryPage from './components/TelemetryPage';
import DroneMap from './components/DroneMap';
import DevPage from './components/DevPage';
import { createDroneAPI } from './api/droneAPI';
import { useRosbridgeConnection } from './hooks/useRosbridgeConnection';
import { useDroneState } from './hooks/useDroneState';
import { useDroneDiscovery } from './hooks/useDroneDiscovery';
import FleetDashboard from './components/FleetDashboard';
import { Badge } from './components/ui/badge';
import './App.css';

type OpsState = 'OFFLINE' | 'STANDBY' | 'READY' | 'EXECUTING' | 'AIRBORNE' | 'UNKNOWN';

const getOpsState = (isConnected: boolean, armed: boolean, flightMode: string): OpsState => {
  if (!isConnected) return 'OFFLINE';

  const mode = (flightMode || '').toUpperCase();
  const autonomousModes = ['OFFBOARD', 'MISSION', 'AUTO_MISSION', 'AUTO_LOITER', 'AUTO'];

  if (armed && autonomousModes.some(m => mode.includes(m))) return 'EXECUTING';
  if (armed) return 'AIRBORNE';
  if (!armed && mode.includes('OFFBOARD')) return 'READY';
  if (!armed) return 'STANDBY';

  return 'UNKNOWN';
};

const App: React.FC = () => {

  // Altitude control state for map clicks
  const [targetAltitude, setTargetAltitude] = useState(15);
  const [maxAltitude, setMaxAltitude] = useState(50);


  // Rosbridge connection
  const { isConnected } = useRosbridgeConnection();

  // Drone state management
  const { droneStatus, refreshDroneState, setTargetDrone } = useDroneState(isConnected);

  // Drone discovery
  const { availableDrones } = useDroneDiscovery(isConnected, droneStatus.drone_name, setTargetDrone);

  // Create drone API with current drone name
  const droneAPI = React.useMemo(() => createDroneAPI({
    droneName: droneStatus.drone_name,
    onRefreshState: refreshDroneState,
    onSetTargetDrone: setTargetDrone
  }), [droneStatus.drone_name, refreshDroneState, setTargetDrone]);

  const opsState = getOpsState(isConnected, droneStatus.armed, droneStatus.flight_mode);

  return (
    <Router>
      <div className="app">
        {/* Single consolidated header */}
        <header className="app-header">
          <span className="header-brand">DRONEOS</span>
          <Badge className={`ops-badge ops-${opsState.toLowerCase()}`}>{opsState}</Badge>
          <span className="ops-state-meta">mode: {droneStatus.flight_mode}</span>
          <div className="header-status">
            <span className="header-stat">{droneStatus.drone_name || 'drone'}</span>
            <span className="header-stat-divider">|</span>
            <span className={`header-stat ${droneStatus.battery > 50 ? 'bat-good' : droneStatus.battery > 25 ? 'bat-warn' : 'bat-crit'}`}>
              BAT {droneStatus.battery}%
            </span>
            <span className="header-stat-divider">|</span>
            <span className={`header-stat ${isConnected ? 'conn-on' : 'conn-off'}`}>
              {isConnected ? 'CONNECTED' : 'DISCONNECTED'}
            </span>
          </div>
        </header>

        <Routes>
          <Route path="/" element={
            <FleetDashboard
              droneAPI={droneAPI}
              droneStatus={droneStatus}
              availableDrones={availableDrones}
              isConnected={isConnected}
              setTargetDrone={setTargetDrone}
              targetAltitude={targetAltitude}
              setTargetAltitude={setTargetAltitude}
              maxAltitude={maxAltitude}
              setMaxAltitude={setMaxAltitude}
            />
          } />

          <Route path="/telemetry" element={
            <main className="page-main">
              <TelemetryPage droneAPI={droneAPI} droneStatus={droneStatus} />
            </main>
          } />

          <Route path="/map" element={
            <main className="page-main">
              <DroneMap droneAPI={droneAPI} droneStatus={droneStatus} availableDrones={availableDrones} />
            </main>
          } />

          {/* /ai route removed */}
          <Route path="/dev" element={
            <main className="page-main">
              <DevPage ros={null} isConnected={isConnected} />
            </main>
          } />
        </Routes>
      </div>
    </Router>
  );
};

export default App;
