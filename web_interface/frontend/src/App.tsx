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

type OpsState = 'OFFLINE' | 'ONLINE' | 'STANDBY' | 'EXECUTING' | 'AIRBORNE';

const getOpsState = (isConnected: boolean, armed: boolean, flightMode: string): OpsState => {
  if (!isConnected) return 'OFFLINE';

  const mode = (flightMode || '').toUpperCase();
  const autonomousModes = ['OFFBOARD', 'MISSION', 'AUTO_MISSION', 'AUTO_LOITER', 'AUTO'];

  if (armed && autonomousModes.some(m => mode.includes(m))) return 'EXECUTING';
  if (armed) return 'AIRBORNE';
  if (!armed && mode.includes('OFFBOARD')) return 'STANDBY';
  if (!armed) return 'ONLINE';

  return 'OFFLINE';
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
          <div className="header-left">
            <span className="header-brand">DRONEOS</span>
            <span className="header-tagline">AI Fleet Command</span>
          </div>
          <div className="header-center">
            <span className="header-subtitle">AI fleet orchestration for PX4 Autopilot + ROS 2</span>
            <span className="header-openclaw">powered by OpenClaw</span>
          </div>
          <div className="header-right">
            <a 
              href="https://github.com/ortegarod/drone-os" 
              target="_blank" 
              rel="noopener noreferrer"
              className="header-github"
              title="View on GitHub"
            >
              <svg height="20" width="20" viewBox="0 0 16 16" fill="currentColor">
                <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"></path>
              </svg>
            </a>
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
              opsState={opsState}
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
