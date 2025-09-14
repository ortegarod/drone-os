import React, { useState, useEffect } from 'react';
import AIInterface from './components/AIInterface';
import SimpleCameraFeed from './components/SimpleCameraFeed';
import TelemetryPage from './components/TelemetryPage';
import MiniMap from './components/MiniMap';
import DroneMap from './components/DroneMap';
import DevPage from './components/DevPage';
import RuneScapeMenu from './components/RuneScapeMenu';
import AltitudeControl from './components/AltitudeControl';
import TargetStatusDisplay from './components/TargetStatusDisplay';
import { rosbridgeClient } from './services/rosbridgeClient';
import './App.css';

// rosbridge WebSocket URL
const ROSBRIDGE_URL = 'ws://localhost:9090';

export interface DroneStatus {
  drone_name: string;
  connected: boolean;
  armed: boolean;
  flight_mode: string;
  position: {
    x: number;
    y: number;
    z: number;
    yaw: number;
  };
  battery: number;
  timestamp: number;
}

export type UnitSystem = 'metric' | 'imperial';

export interface UnitPreferences {
  system: UnitSystem;
  distance: string; // 'm' or 'ft'
  speed: string;    // 'm/s' or 'ft/s'
  temperature: string; // 'C' or 'F'
}

// Unit conversion utilities
export const convertDistance = (meters: number, system: UnitSystem): number => {
  return system === 'imperial' ? meters * 3.28084 : meters;
};

export const convertSpeed = (mps: number, system: UnitSystem): number => {
  return system === 'imperial' ? mps * 3.28084 : mps;
};

export const convertTemperature = (celsius: number, system: UnitSystem): number => {
  return system === 'imperial' ? (celsius * 9/5) + 32 : celsius;
};

export const getDistanceUnit = (system: UnitSystem): string => {
  return system === 'imperial' ? 'ft' : 'm';
};

export const getSpeedUnit = (system: UnitSystem): string => {
  return system === 'imperial' ? 'ft/s' : 'm/s';
};

export const getTemperatureUnit = (system: UnitSystem): string => {
  return system === 'imperial' ? '°F' : '°C';
};

const App: React.FC = () => {
  const [currentPage, setCurrentPage] = useState<'main' | 'telemetry' | 'map' | 'ai' | 'dev'>('main');
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

  // Helper function for Trigger services using rosbridgeClient
  const callTriggerService = async (serviceName: string) => {
    if (!isConnected) {
      throw new Error('Not connected to rosbridge');
    }

    try {
      const result = await rosbridgeClient.callArmService(droneStatus.drone_name); // For now, we'll use callArmService as template
      // Refresh state after command
      setTimeout(() => refreshDroneState(), 1000);
      return result;
    } catch (error) {
      console.error('[DEBUG]', serviceName, 'failed:', error);
      throw new Error(`${serviceName} failed: ${error}`);
    }
  };

  // Drone API using rosbridgeClient for actual service calls
  const droneAPI = React.useMemo(() => ({
    ros: null, // Keep null to indicate we're using rosbridgeClient instead of ROSLIB
    // Basic flight commands using our rosbridgeClient
    arm: async () => {
      console.log('[TRACE] ARM button clicked');
      const actualConnectionStatus = rosbridgeClient.getConnectionStatus();
      console.log('[TRACE] RosbridgeClient connected:', actualConnectionStatus);

      if (!actualConnectionStatus) {
        throw new Error('Not connected to drone control system');
      }

      try {
        console.log('[TRACE] Calling callArmService for drone:', droneStatus.drone_name);
        const result = await rosbridgeClient.callArmService(droneStatus.drone_name);
        console.log('[TRACE] ARM service result:', result);
        setTimeout(() => refreshDroneState(), 1000);
        // Return the actual service response
        return {
          success: result.success,
          message: result.message || (result.success ? 'Command executed' : 'Command failed')
        };
      } catch (error) {
        console.error('[TRACE] ARM service error:', error);
        throw new Error(`Arm command failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
      }
    },
    disarm: async () => {
      const actualConnectionStatus = rosbridgeClient.getConnectionStatus();
      if (!actualConnectionStatus) throw new Error('Not connected to drone control system');
      try {
        const result = await rosbridgeClient.callDisarmService(droneStatus.drone_name);
        setTimeout(() => refreshDroneState(), 1000);
        // Return the actual service response
        return {
          success: result.success,
          message: result.message || (result.success ? 'Command executed' : 'Command failed')
        };
      } catch (error) {
        throw new Error(`Disarm command failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
      }
    },
    takeoff: () => Promise.resolve({ success: false, message: 'Use CLI or web interface for takeoff' }),
    land: () => Promise.resolve({ success: false, message: 'Use CLI or web interface for land' }),
    returnToLaunch: () => Promise.resolve({ success: false, message: 'Use CLI or web interface for RTL' }),
    flightTermination: () => Promise.resolve({ success: false, message: 'Use CLI or web interface for termination' }),
    setOffboard: async () => {
      const actualConnectionStatus = rosbridgeClient.getConnectionStatus();
      if (!actualConnectionStatus) throw new Error('Not connected to drone control system');
      try {
        const result = await rosbridgeClient.callSetOffboardService(droneStatus.drone_name);
        setTimeout(() => refreshDroneState(), 1000);
        // Return the actual service response
        return {
          success: result.success,
          message: result.message || (result.success ? 'Command executed' : 'Command failed')
        };
      } catch (error) {
        throw new Error(`Set offboard failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
      }
    },
    
    // Position control (placeholder)
    setPosition: (x: number, y: number, z: number, yaw: number) => {
      return Promise.resolve({ success: false, message: 'Use CLI or web interface for position control' });
    },

    setPositionAutoYaw: (x: number, y: number, z: number) => {
      return Promise.resolve({ success: false, message: 'Use CLI or web interface for position control' });
    },

    // Get drone state using rosbridgeClient
    getState: () => {
      if (!rosbridgeClient.getConnectionStatus()) {
        return Promise.reject(new Error('Not connected to rosbridge'));
      }
      
      return rosbridgeClient.callGetStateService(droneStatus.drone_name);
    },

    // Target management
    setTargetDrone: (drone_name: string) => {
      const old_target = droneStatus.drone_name;
      setDroneStatus(prev => ({ ...prev, drone_name: drone_name }));
      
      return Promise.resolve({
        success: true,
        message: `Target changed from ${old_target} to ${drone_name}`,
        old_target,
        new_target: drone_name
      });
    },

    // Simplified network/drone discovery
    getNetwork: () => {
      return Promise.resolve({
        services: [],
        target_drone: droneStatus.drone_name
      });
    },

    getDroneServices: () => {
      return Promise.resolve({
        target_drone: droneStatus.drone_name,
        services: []
      });
    },

    discoverDrones: () => {
      // Return default drone list
      return Promise.resolve(['drone1']);
    }
  }), [droneStatus.drone_name]);

  return (
    <div className="app">
      <header className="app-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: '2rem' }}>
          <h1>DroneOS Command Center</h1>
          <nav style={{ display: 'flex', gap: '1rem' }}>
            <button 
              className={`nav-btn ${currentPage === 'main' ? 'active' : ''}`}
              onClick={() => setCurrentPage('main')}
            >
              Main Dashboard
            </button>
            <button 
              className={`nav-btn ${currentPage === 'telemetry' ? 'active' : ''}`}
              onClick={() => setCurrentPage('telemetry')}
            >
              Status
            </button>
            <button 
              className={`nav-btn ${currentPage === 'map' ? 'active' : ''}`}
              onClick={() => setCurrentPage('map')}
            >
              Drone Map
            </button>
            <button 
              className={`nav-btn ${currentPage === 'ai' ? 'active' : ''}`}
              onClick={() => setCurrentPage('ai')}
            >
              AI Assistant <span style={{ fontSize: '0.75rem', opacity: 0.7 }}>(BETA)</span>
            </button>
            <button 
              className={`nav-btn ${currentPage === 'dev' ? 'active' : ''}`}
              onClick={() => setCurrentPage('dev')}
            >
              Dev
            </button>
          </nav>
        </div>
        <div className="connection-status" style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
          {/* Unit System Selector */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <label style={{ fontSize: '0.875rem', color: '#ccc' }}>Units:</label>
            <select 
              value={unitSystem} 
              onChange={(e) => changeUnitSystem(e.target.value as UnitSystem)}
              style={{
                padding: '0.25rem 0.5rem',
                backgroundColor: '#2d2d2d',
                color: '#fff',
                border: '1px solid #555',
                borderRadius: '4px',
                fontSize: '0.875rem'
              }}
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

      {/* Top Status Bar - Single Row with Wrap */}
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
              ({convertDistance(droneStatus.position.x, unitSystem).toFixed(2)}, {convertDistance(droneStatus.position.y, unitSystem).toFixed(2)}, {convertDistance(Math.abs(droneStatus.position.z), unitSystem).toFixed(2)}) {getDistanceUnit(unitSystem)}
            </span>
          </div>
          
          <div className="status-section">
            <span className="status-label">Heading:</span>
            <span className="status-value">{droneStatus.position.yaw.toFixed(2)} RAD</span>
          </div>
        </div>
      </div>

      {currentPage === 'main' ? (
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
      ) : currentPage === 'telemetry' ? (
        <main style={{ flex: 1, overflow: 'hidden' }}>
          <TelemetryPage 
            droneAPI={droneAPI}
            droneStatus={droneStatus}
            unitSystem={unitSystem}
          />
        </main>
      ) : currentPage === 'map' ? (
        <main style={{ flex: 1, overflow: 'hidden' }}>
          <DroneMap 
            droneAPI={droneAPI}
            droneStatus={droneStatus}
            availableDrones={availableDrones}
            unitSystem={unitSystem}
          />
        </main>
      ) : currentPage === 'ai' ? (
        <main style={{ flex: 1, overflow: 'hidden' }}>
          <div style={{ 
            height: '100%', 
            display: 'flex', 
            flexDirection: 'column',
            backgroundColor: '#1a1a1a'
          }}>
            <div style={{ 
              padding: '1rem', 
              borderBottom: '1px solid #444',
              backgroundColor: '#2d2d2d',
              display: 'flex',
              alignItems: 'center',
              gap: '0.5rem'
            }}>
              <h2>🤖 AI Assistant</h2>
              <span style={{ 
                fontSize: '0.75rem', 
                backgroundColor: '#f39c12',
                color: '#000',
                padding: '2px 6px',
                borderRadius: '3px',
                fontWeight: 'bold'
              }}>
                BETA
              </span>
              <div style={{ fontSize: '0.875rem', color: '#888', marginLeft: 'auto' }}>
                Natural language drone control and mission planning
              </div>
            </div>
            <div style={{ flex: 1, padding: '1rem' }}>
              <AIInterface 
                droneAPI={droneAPI}
                droneStatus={droneStatus}
              />
            </div>
          </div>
        </main>
      ) : (
        <main style={{ flex: 1, overflow: 'hidden' }}>
          <DevPage 
            ros={null}
            isConnected={isConnected}
          />
        </main>
      )}

      {/* Bottom Status Bar */}
      <footer className="bottom-status-bar">
        <div className="status-bar-left">
        </div>
        
        <div className="status-bar-right">
          <span className="status-item battery" style={{
            color: droneStatus.battery > 50 ? '#00ff88' : 
                   droneStatus.battery > 25 ? '#ff8800' : '#ff4444'
          }}>
            🔋 {droneStatus.battery}%
          </span>
        </div>
      </footer>
    </div>
  );
};

export default App;
