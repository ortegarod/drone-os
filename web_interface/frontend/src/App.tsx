import React, { useState, useEffect } from 'react';
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
import { rosbridgeClient } from './services/rosbridgeClient';
import {
  UnitSystem,
  convertDistance,
  getDistanceUnit
} from './utils/unitConversions';
import { DroneStatus } from './types/drone';
import { createDroneAPI } from './api/droneAPI';
import './App.css';

const App: React.FC = () => {
  const [droneStatus, setDroneStatus] = useState<DroneStatus>({
    drone_name: 'drone1',
    connected: false,
    armed: false,
    flight_mode: 'UNKNOWN',
    position: { x: 0, y: 0, z: 0, yaw: 0 },
    battery: 0,
    timestamp: 0
  });

  const [isConnected, setIsConnected] = useState(false);
  const [availableDrones, setAvailableDrones] = useState<string[]>([]);
  
  // Unit preferences with localStorage persistence
  const [unitSystem, setUnitSystem] = useState<UnitSystem>(() => {
    const saved = localStorage.getItem('droneOS_units');
    return (saved as UnitSystem) || 'metric';
  });
  
  // Altitude control state for map clicks
  const [targetAltitude, setTargetAltitude] = useState(15); // Default 15m altitude
  const [maxAltitude, setMaxAltitude] = useState(50); // Default 50m max altitude
  const [droneStateSub, setDroneStateSub] = useState<string | null>(null);

  // Save unit preference to localStorage
  const changeUnitSystem = (system: UnitSystem) => {
    setUnitSystem(system);
    localStorage.setItem('droneOS_units', system);
  };

  // Initialize rosbridge connection using shared client
  useEffect(() => {
    // Set up connection status callback
    const handleConnectionStatus = (connected: boolean) => {
      setIsConnected(connected);
      if (connected) {
        // Discover available drones when connected
        discoverAvailableDrones();
      }
    };

    // Register connection callback
    rosbridgeClient.onConnectionStatusChanged(handleConnectionStatus);

    // Check current connection status and connect if needed
    const currentStatus = rosbridgeClient.getConnectionStatus();
    if (!currentStatus) {
      rosbridgeClient.connect();
    } else {
      setIsConnected(true);
      discoverAvailableDrones();
    }

    // Cleanup on unmount
    return () => {
      rosbridgeClient.removeConnectionStatusCallback(handleConnectionStatus);
    };
  }, []);
  
  // Function to refresh drone state using shared rosbridge client
  const refreshDroneState = async () => {
    try {
      const result = await rosbridgeClient.callGetStateService(droneStatus.drone_name);
      if (result.success) {
        setDroneStatus(prev => ({
          ...prev,
          connected: true,
          armed: result.arming_state === 'ARMED',
          flight_mode: result.nav_state || 'UNKNOWN',
          position: {
            x: result.local_x || 0,
            y: result.local_y || 0,
            z: result.local_z || 0,
            yaw: result.local_yaw || 0
          },
          battery: Math.round((result.battery_remaining || 0) * 100),
          timestamp: Date.now()
        }));
      }
    } catch (error) {
      console.error('[DEBUG] Refresh state error:', error);
    }
  };

  // Function to discover available drones
  const discoverAvailableDrones = async () => {
    try {
      // For now, set default drone - could be enhanced to discover dynamically via rosbridgeClient
      const discoveredDrones = ['drone1'];
      setAvailableDrones(discoveredDrones);
      
      // If current drone is not in discovered list, switch to first available
      if (discoveredDrones.length > 0 && !discoveredDrones.includes(droneStatus.drone_name)) {
        setDroneStatus(prev => ({ ...prev, drone_name: discoveredDrones[0] }));
      }
    } catch (error) {
      console.warn('Drone discovery error:', error);
      setAvailableDrones(['drone1']);
    }
  };
  
  // Start subscription to drone state using rosbridgeClient
  const startDroneStateSubscription = () => {
    // Clear any existing subscription
    if (droneStateSub) {
      rosbridgeClient.unsubscribeFromDroneState(droneStateSub);
    }
    
    // Subscribe to drone state updates
    const subscriptionId = rosbridgeClient.subscribeToDroneState(
      droneStatus.drone_name,
      (state) => {
        setDroneStatus(prev => ({
          ...prev,
          connected: true,
          armed: state.arming_state === 'ARMED',
          flight_mode: state.nav_state || 'UNKNOWN',
          position: {
            x: state.local_x || 0,
            y: state.local_y || 0,
            z: state.local_z || 0,
            yaw: state.local_yaw || 0
          },
          battery: Math.round((state.battery_remaining || 0) * 100),
          timestamp: Date.now()
        }));
      }
    );
    
    setDroneStateSub(subscriptionId);
  };
  
  // Handle drone name changes - restart subscription for new drone
  useEffect(() => {
    if (isConnected) {
      startDroneStateSubscription();
    }
  }, [isConnected, droneStatus.drone_name]);

  // Create drone API with current drone name
  const droneAPI = React.useMemo(() => createDroneAPI({
    droneName: droneStatus.drone_name,
    onRefreshState: refreshDroneState,
    onSetTargetDrone: (droneName: string) => {
      setDroneStatus(prev => ({ ...prev, drone_name: droneName }));
    }
  }), [droneStatus.drone_name]);

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
            {/* Unit System Selector */}
            <div className="unit-selector-container">
              <label className="unit-selector-label">Units:</label>
              <select
                value={unitSystem}
                onChange={(e) => changeUnitSystem(e.target.value as UnitSystem)}
                className="unit-selector"
              >
                <option value="metric">Metric (m)</option>
                <option value="imperial">Imperial (ft)</option>
              </select>
            </div>

            <span className={`status-indicator ${isConnected ? 'connected' : 'disconnected'}`}>
              {isConnected ? '🟢 Connected to rosbridge' : '🔴 Disconnected from rosbridge'}
            </span>
          </div>
        </header>

        {/* Top Status Bar */}
        <TopStatusBar droneStatus={droneStatus} unitSystem={unitSystem} />

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
                    unitSystem={unitSystem}
                  />
                </div>

                {/* Right panel container for both MiniMap and RuneScape menu */}
                <div className="right-panel-container">
                  <TargetStatusDisplay
                    droneStatus={droneStatus}
                    unitSystem={unitSystem}
                    convertDistance={convertDistance}
                    getDistanceUnit={getDistanceUnit}
                  />
                  {/* MiniMap in its own container */}
                  <div className="minimap-container">
                    <MiniMap
                      droneAPI={droneAPI}
                      droneStatus={droneStatus}
                      availableDrones={availableDrones}
                      unitSystem={unitSystem}
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
                      unitSystem={unitSystem}
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
                unitSystem={unitSystem}
              />
            </main>
          } />

          <Route path="/map" element={
            <main className="page-main">
              <DroneMap
                droneAPI={droneAPI}
                droneStatus={droneStatus}
                availableDrones={availableDrones}
                unitSystem={unitSystem}
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
