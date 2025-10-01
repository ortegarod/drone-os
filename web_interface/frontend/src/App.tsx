import React, { useState } from 'react';
import { BrowserRouter as Router, Routes, Route, NavLink } from 'react-router-dom';
import AIInterface from './components/AIInterface';
import SimpleCameraFeed from './components/SimpleCameraFeed';
import TelemetryPage from './components/TelemetryPage';
import MiniMap from './components/MiniMap';
import DroneMap from './components/DroneMap';
import DevPage from './components/DevPage';
import RuneScapeMenu from './components/RuneScapeMenu';
import AltitudeControl from './components/AltitudeControl';
import TargetStatusDisplay from './components/TargetStatusDisplay';
import TopStatusBar from './components/TopStatusBar';
import BottomStatusBar from './components/BottomStatusBar';
import { createDroneAPI } from './api/droneAPI';
import { useRosbridgeConnection } from './hooks/useRosbridgeConnection';
import { useDroneState } from './hooks/useDroneState';
import { useDroneDiscovery } from './hooks/useDroneDiscovery';
import './App.css';

const App: React.FC = () => {

  // Altitude control state for map clicks
  const [targetAltitude, setTargetAltitude] = useState(15); // Default 15m altitude
  const [maxAltitude, setMaxAltitude] = useState(50); // Default 50m max altitude

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
        <header className="app-header">
          <div className="header-nav-container">
            <h1>DroneOS Command Center</h1>
            <nav className="header-nav">
              <NavLink
                to="/"
                className={({ isActive }) => `nav-btn ${isActive ? 'active' : ''}`}
              >
                Main Dashboard
              </NavLink>
              <NavLink
                to="/telemetry"
                className={({ isActive }) => `nav-btn ${isActive ? 'active' : ''}`}
              >
                Status
              </NavLink>
              <NavLink
                to="/map"
                className={({ isActive }) => `nav-btn ${isActive ? 'active' : ''}`}
              >
                Drone Map
              </NavLink>
              <NavLink
                to="/ai"
                className={({ isActive }) => `nav-btn ${isActive ? 'active' : ''}`}
              >
                AI Assistant <span className="nav-beta-label">(BETA)</span>
              </NavLink>
              <NavLink
                to="/dev"
                className={({ isActive }) => `nav-btn ${isActive ? 'active' : ''}`}
              >
                Dev
              </NavLink>
            </nav>
          </div>
          <div className="connection-status">
            <span className={`status-indicator ${isConnected ? 'connected' : 'disconnected'}`}>
              {isConnected ? '🟢 Connected to rosbridge' : '🔴 Disconnected from rosbridge'}
            </span>
          </div>
        </header>

        {/* Top Status Bar */}
        <TopStatusBar droneStatus={droneStatus} />

        <Routes>
          <Route path="/" element={
            <div className="app-main-new">
              {/* Main content area */}
              <div className="main-content">
                {/* Center area for camera feed only */}
                <div className="center-area">
                  <SimpleCameraFeed
                    droneAPI={droneAPI}
                    isConnected={isConnected}
                    droneStatus={droneStatus}
                  />
                </div>

                {/* Right panel container for both MiniMap and RuneScape menu */}
                <div className="right-panel-container">
                  <TargetStatusDisplay
                    droneStatus={droneStatus}
                  />
                  {/* MiniMap in its own container */}
                  <div className="minimap-container">
                    <MiniMap
                      droneAPI={droneAPI}
                      droneStatus={droneStatus}
                      availableDrones={availableDrones}
                      targetAltitude={targetAltitude}
                    />
                  </div>

                  {/* Altitude Control Slider */}
                  <AltitudeControl
                    targetAltitude={targetAltitude}
                    setTargetAltitude={setTargetAltitude}
                    maxAltitude={maxAltitude}
                    setMaxAltitude={setMaxAltitude}
                  />

                  {/* RuneScape-style menu */}
                  <div className="right-menu">
                    <RuneScapeMenu
                      droneAPI={droneAPI}
                      droneStatus={droneStatus}
                      availableDrones={availableDrones}
                      isConnected={isConnected}
                    />
                  </div>
                </div>
              </div>
            </div>
          } />

          <Route path="/telemetry" element={
            <main className="page-main">
              <TelemetryPage
                droneAPI={droneAPI}
                droneStatus={droneStatus}
              />
            </main>
          } />

          <Route path="/map" element={
            <main className="page-main">
              <DroneMap
                droneAPI={droneAPI}
                droneStatus={droneStatus}
                availableDrones={availableDrones}
              />
            </main>
          } />

          <Route path="/ai" element={
            <main className="page-main">
              <div className="ai-page-container">
                <div className="ai-page-header">
                  <h2>🤖 AI Assistant</h2>
                  <span className="ai-beta-badge">BETA</span>
                  <div className="ai-page-description">
                    Natural language drone control and mission planning
                  </div>
                </div>
                <div className="ai-page-content">
                  <AIInterface
                    droneAPI={droneAPI}
                    droneStatus={droneStatus}
                  />
                </div>
              </div>
            </main>
          } />

          <Route path="/dev" element={
            <main className="page-main">
              <DevPage
                ros={null}
                isConnected={isConnected}
              />
            </main>
          } />
        </Routes>

        {/* Bottom Status Bar */}
        <BottomStatusBar droneStatus={droneStatus} />
      </div>
    </Router>
  );
};

export default App;
