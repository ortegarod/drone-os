import React, { useState } from 'react';
import { BrowserRouter as Router, Routes, Route, NavLink } from 'react-router-dom';
import AIInterface from './components/AIInterface';
import TelemetryPage from './components/TelemetryPage';
import MiniMap from './components/MiniMap';
import DroneMap from './components/DroneMap';
import DevPage from './components/DevPage';
import DroneMenu from './components/DroneMenu';
import SimpleCameraFeed from './components/SimpleCameraFeed';
import { createDroneAPI } from './api/droneAPI';
import { useRosbridgeConnection } from './hooks/useRosbridgeConnection';
import { useDroneState } from './hooks/useDroneState';
import { useDroneDiscovery } from './hooks/useDroneDiscovery';
import { Badge } from './components/ui/badge';
import { Card, CardContent } from './components/ui/card';
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
        {/* Compact header: nav + status in one row */}
        <header className="app-header">
          <nav className="header-nav">
            <NavLink to="/" className={({ isActive }) => `nav-btn ${isActive ? 'active' : ''}`}>Dashboard</NavLink>
            <NavLink to="/telemetry" className={({ isActive }) => `nav-btn ${isActive ? 'active' : ''}`}>Status</NavLink>
            <NavLink to="/map" className={({ isActive }) => `nav-btn ${isActive ? 'active' : ''}`}>Map</NavLink>
            <NavLink to="/ai" className={({ isActive }) => `nav-btn ${isActive ? 'active' : ''}`}>AI</NavLink>
            <NavLink to="/dev" className={({ isActive }) => `nav-btn ${isActive ? 'active' : ''}`}>Dev</NavLink>
          </nav>
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

        <Card className="mx-2 my-1 border-border bg-card">
          <CardContent className="flex h-10 items-center gap-3 p-2">
            <span className="ops-state-label">OPS STATE</span>
            <Badge className={`ops-badge ops-${opsState.toLowerCase()}`}>{opsState}</Badge>
            <span className="ops-state-meta">mode: {droneStatus.flight_mode}</span>
          </CardContent>
        </Card>

        <Routes>
          <Route path="/" element={
            <div className="ops-layout two-column">
              <main className="ops-main-left">
                <Card className="h-full border-border bg-card">
                  <CardContent className="h-full p-2 flex flex-col gap-2">
                    <div className="left-camera-wrap">
                      <SimpleCameraFeed
                        droneAPI={droneAPI}
                        isConnected={isConnected}
                        droneStatus={droneStatus}
                      />
                    </div>
                    <div className="left-console-wrap">
                      <AIInterface droneAPI={droneAPI} droneStatus={droneStatus} />
                    </div>
                  </CardContent>
                </Card>
              </main>

              <aside className="ops-right">
                <Card className="h-full border-border bg-card">
                  <CardContent className="h-full p-2 flex flex-col gap-2">
                    <div className="drone-switch-row">
                      <span className="drone-switch-label">Active Drone</span>
                      <select
                        className="drone-switch-select"
                        value={droneStatus.drone_name || ''}
                        onChange={(e) => setTargetDrone(e.target.value)}
                      >
                        {availableDrones.map((drone) => (
                          <option key={drone} value={drone}>{drone}</option>
                        ))}
                      </select>
                    </div>
                    <div className="right-map-wrap">
                      <MiniMap
                        droneAPI={droneAPI}
                        droneStatus={droneStatus}
                        availableDrones={availableDrones}
                        targetAltitude={targetAltitude}
                      />
                    </div>
                    <div className="right-controls-wrap">
                      <DroneMenu
                        droneAPI={droneAPI}
                        droneStatus={droneStatus}
                        availableDrones={availableDrones}
                        isConnected={isConnected}
                        targetAltitude={targetAltitude}
                        setTargetAltitude={setTargetAltitude}
                        maxAltitude={maxAltitude}
                        setMaxAltitude={setMaxAltitude}
                      />
                    </div>
                  </CardContent>
                </Card>
              </aside>
            </div>
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

          <Route path="/ai" element={
            <main className="page-main">
              <div className="ai-page-container">
                <div className="ai-page-header">
                  <h2>AI Assistant</h2>
                  <span className="ai-beta-badge">BETA</span>
                </div>
                <div className="ai-page-content">
                  <AIInterface droneAPI={droneAPI} droneStatus={droneStatus} />
                </div>
              </div>
            </main>
          } />

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
