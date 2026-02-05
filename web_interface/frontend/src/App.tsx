import React, { useState } from 'react';
import { BrowserRouter as Router, Routes, Route, NavLink } from 'react-router-dom';
import AIInterface from './components/AIInterface';
import SimpleCameraFeed from './components/SimpleCameraFeed';
import TelemetryPage from './components/TelemetryPage';
import MiniMap from './components/MiniMap';
import DroneMap from './components/DroneMap';
import DevPage from './components/DevPage';
import DroneMenu from './components/DroneMenu';
import { createDroneAPI } from './api/droneAPI';
import { useRosbridgeConnection } from './hooks/useRosbridgeConnection';
import { useDroneState } from './hooks/useDroneState';
import { useDroneDiscovery } from './hooks/useDroneDiscovery';
import './App.css';

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
            <span className="header-stat">{droneStatus.drone_name || '...'}</span>
            <span className="header-stat-divider">|</span>
            <span className={`header-stat ${droneStatus.armed ? 'armed' : ''}`}>{droneStatus.armed ? 'ARMED' : 'DISARMED'}</span>
            <span className="header-stat-divider">|</span>
            <span className="header-stat">{droneStatus.flight_mode}</span>
            <span className="header-stat-divider">|</span>
            <span className="header-stat">Pos: ({droneStatus.position.x.toFixed(1)}, {droneStatus.position.y.toFixed(1)}, {Math.abs(droneStatus.position.z).toFixed(1)})m</span>
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
            <div className="dashboard">
              {/* Camera feed */}
              <div className="dashboard-camera">
                <SimpleCameraFeed
                  droneAPI={droneAPI}
                  isConnected={isConnected}
                  droneStatus={droneStatus}
                />
              </div>

              {/* Right panel: minimap + controls */}
              <div className="dashboard-sidebar">
                <div className="minimap-container">
                  <MiniMap
                    droneAPI={droneAPI}
                    droneStatus={droneStatus}
                    availableDrones={availableDrones}
                    targetAltitude={targetAltitude}
                  />
                </div>

                <div className="sidebar-controls">
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
              </div>
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
