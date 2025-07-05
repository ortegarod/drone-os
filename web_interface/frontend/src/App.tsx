import React, { useState, useEffect } from 'react';
// @ts-ignore
import ROSLIB from 'roslib';
import AIInterface from './components/AIInterface';
import SimpleCameraFeed from './components/SimpleCameraFeed';
import TelemetryPage from './components/TelemetryPage';
import MiniMap from './components/MiniMap';
import DroneMap from './components/DroneMap';
import DevPage from './components/DevPage';
import FlightControlsHotbar from './components/FlightControlsHotbar';
import RuneScapeMenu from './components/RuneScapeMenu';
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
  const [ros, setRos] = useState<any>(null);
  const [availableDrones, setAvailableDrones] = useState<string[]>([]);
  const [droneStateSub, setDroneStateSub] = useState<any>(null);
  
  // Unit preferences with localStorage persistence
  const [unitSystem, setUnitSystem] = useState<UnitSystem>(() => {
    const saved = localStorage.getItem('droneOS_units');
    return (saved as UnitSystem) || 'metric';
  });

  // Save unit preference to localStorage
  const changeUnitSystem = (system: UnitSystem) => {
    setUnitSystem(system);
    localStorage.setItem('droneOS_units', system);
  };

  // Initialize rosbridge connection
  useEffect(() => {
    const connectRosbridge = () => {
      const rosInstance = new ROSLIB.Ros({
        url: ROSBRIDGE_URL
      });

      rosInstance.on('connection', () => {
        console.log('[DEBUG] Connected to rosbridge WebSocket at', ROSBRIDGE_URL);
        setIsConnected(true);
        setRos(rosInstance);
        
        // Start real-time drone state subscription
        console.log('[DEBUG] Starting drone state subscription...');
        startDroneStateSubscription(rosInstance);
        
        // Discover available drones
        console.log('[DEBUG] Discovering available drones...');
        discoverAvailableDrones(rosInstance);
      });

      rosInstance.on('error', (error: any) => {
        console.error('[DEBUG] rosbridge connection error:', error);
        setIsConnected(false);
      });

      rosInstance.on('close', () => {
        console.log('[DEBUG] rosbridge connection closed - attempting reconnect in 3s');
        setIsConnected(false);
        setRos(null);
        // Attempt to reconnect after 3 seconds
        setTimeout(connectRosbridge, 3000);
      });
    };

    connectRosbridge();

    // Cleanup on unmount
    return () => {
      if (droneStateSub) {
        clearInterval(droneStateSub);
      }
      if (ros) {
        ros.close();
      }
    };
  }, []);
  
  // Function to refresh drone state using drone_core service (one-time fetch)
  const refreshDroneState = (rosInstance: any) => {
    const getStateService = new ROSLIB.Service({
      ros: rosInstance,
      name: `/${droneStatus.drone_name}/get_state`,
      serviceType: 'drone_interfaces/srv/GetState'
    });

    const request = new ROSLIB.ServiceRequest({});
    
    getStateService.callService(request, (result: any) => {
      if (result.success) {
        setDroneStatus(prev => ({
          ...prev,
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
    }, (error: any) => {
      console.error('[DEBUG] Refresh state error:', error);
    });
  };

  // Function to discover available drones
  const discoverAvailableDrones = async (rosInstance: any) => {
    try {
      const getServicesService = new ROSLIB.Service({
        ros: rosInstance,
        name: '/rosapi/services',
        serviceType: 'rosapi_msgs/srv/Services'
      });

      const request = new ROSLIB.ServiceRequest({});
      
      getServicesService.callService(request, (result: any) => {
        // Look for /droneX/get_state services to identify available drones
        const droneServices = result.services.filter((s: string) => 
          s.match(/^\/drone\d+\/get_state$/)
        );
        
        // Extract drone names (e.g., "drone1" from "/drone1/get_state")
        const discoveredDrones = droneServices.map((s: string) => 
          s.split('/')[1]
        ).sort((a: string, b: string) => {
          // Sort numerically (drone1, drone2, ..., drone10, ...)
          const aNum = parseInt(a.replace('drone', ''));
          const bNum = parseInt(b.replace('drone', ''));
          return aNum - bNum;
        });
        
        setAvailableDrones(discoveredDrones);
        console.log('Discovered drones:', discoveredDrones);
        
        // If current drone is not in discovered list, switch to first available
        if (discoveredDrones.length > 0 && !discoveredDrones.includes(droneStatus.drone_name)) {
          setDroneStatus(prev => ({ ...prev, drone_name: discoveredDrones[0] }));
        }
      }, (error: any) => {
        console.warn('Failed to discover drones:', error);
        // Fallback to default drone list
        setAvailableDrones(['drone1']);
      });
    } catch (error) {
      console.warn('Drone discovery error:', error);
      setAvailableDrones(['drone1']);
    }
  };
  
  // Start periodic polling of drone_core get_state service
  const startDroneStateSubscription = (rosInstance: any) => {
    // Clear any existing polling interval
    if (droneStateSub) {
      console.log('[DEBUG] Clearing previous state polling interval');
      clearInterval(droneStateSub);
    }
    
    console.log('[DEBUG] Starting periodic state polling for', droneStatus.drone_name);
    
    // Function to poll state via service
    const pollDroneState = async () => {
      try {
        const getStateService = new ROSLIB.Service({
          ros: rosInstance,
          name: `/${droneStatus.drone_name}/get_state`,
          serviceType: 'drone_interfaces/srv/GetState'
        });

        const request = new ROSLIB.ServiceRequest({});
        
        getStateService.callService(request, (result: any) => {
          console.log('[DEBUG] State service response:', {
            success: result.success,
            armed: result.arming_state,
            mode: result.nav_state,
            position: [result.local_x, result.local_y, result.local_z],
            battery: result.battery_remaining,
            timestamp: new Date().toLocaleTimeString()
          });
          
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
        }, (error: any) => {
          console.error('[DEBUG] State service error:', error);
        });
      } catch (error) {
        console.error('[DEBUG] State polling error:', error);
      }
    };

    // Initial poll
    pollDroneState();
    
    // Set up periodic polling every 2 seconds
    const pollInterval = setInterval(pollDroneState, 2000);
    setDroneStateSub(pollInterval);
    
    console.log('[DEBUG] State polling established for', droneStatus.drone_name, '(2 second interval)');
  };
  
  // Handle drone name changes - restart subscription for new drone
  useEffect(() => {
    if (ros && isConnected) {
      startDroneStateSubscription(ros);
    }
  }, [ros, isConnected, droneStatus.drone_name]);

  // Drone Control API using roslibjs (mirroring CLI behavior)
  const droneAPI = React.useMemo(() => ({
    get ros() { return ros; }, // Make ros reactive to state changes
    
    // Basic flight commands using std_srvs/srv/Trigger
    arm: () => callTriggerService('arm'),
    disarm: () => callTriggerService('disarm'),
    takeoff: () => callTriggerService('takeoff'),
    land: () => callTriggerService('land'),
    setOffboard: () => callTriggerService('set_offboard'),
    
    // Position control (mirrors CLI 'pos x y z yaw' command)
    setPosition: (x: number, y: number, z: number, yaw: number) => {
      if (!ros) {
        return Promise.reject(new Error('Not connected to rosbridge'));
      }
      
      console.log('[DEBUG] Sending setPosition command:', { x, y, z, yaw, drone: droneStatus.drone_name });
      
      return new Promise((resolve, reject) => {
        const serviceName = `/${droneStatus.drone_name}/set_position`;
        const setPositionService = new ROSLIB.Service({
          ros: ros,
          name: serviceName,
          serviceType: 'drone_interfaces/srv/SetPosition'
        });

        const request = new ROSLIB.ServiceRequest({ x, y, z, yaw });
        
        setPositionService.callService(request, (result: any) => {
          console.log('[DEBUG] setPosition response:', { success: result.success, message: result.message });
          resolve({ success: result.success, message: result.message });
          // Refresh state after command
          setTimeout(() => refreshDroneState(ros), 1000);
        }, (error: any) => {
          console.error('[DEBUG] setPosition failed:', error);
          reject(new Error(`SetPosition failed: ${error}`));
        });
      });
    },

    // Position control with automatic yaw calculation
    setPositionAutoYaw: (x: number, y: number, z: number) => {
      if (!ros) {
        return Promise.reject(new Error('Not connected to rosbridge'));
      }
      
      // Calculate yaw to point towards target
      const current_x = droneStatus.position.x;
      const current_y = droneStatus.position.y;
      const yaw_to_target = Math.atan2(y - current_y, x - current_x);
      
      console.log('[DEBUG] Auto-calculated yaw:', { 
        from: [current_x, current_y], 
        to: [x, y], 
        yaw_radians: yaw_to_target,
        yaw_degrees: yaw_to_target * 180 / Math.PI
      });
      
      return droneAPI.setPosition(x, y, z, yaw_to_target);
    },

    // Get drone state using drone_core service
    getState: () => {
      if (!ros) {
        return Promise.reject(new Error('Not connected to rosbridge'));
      }
      
      return new Promise((resolve, reject) => {
        const getStateService = new ROSLIB.Service({
          ros: ros,
          name: `/${droneStatus.drone_name}/get_state`,
          serviceType: 'drone_interfaces/srv/GetState'
        });

        const request = new ROSLIB.ServiceRequest({});
        
        getStateService.callService(request, (result: any) => {
          resolve({ 
            success: result.success, 
            message: result.success ? 'State retrieved from drone_core' : 'Failed to get state', 
            state: result
          });
        }, (error: any) => {
          reject(new Error(`GetState service failed: ${error}`));
        });
      });
    },

    // Target management (mirrors CLI 'target' command)
    setTargetDrone: (drone_name: string) => {
      const old_target = droneStatus.drone_name;
      setDroneStatus(prev => ({ ...prev, drone_name: drone_name }));
      
      // Refresh state for new target
      if (ros) {
        setTimeout(() => refreshDroneState(ros), 500);
      }
      
      return Promise.resolve({
        success: true,
        message: `Target changed from ${old_target} to ${drone_name}`,
        old_target,
        new_target: drone_name
      });
    },

    // Network discovery (for monitoring)
    getNetwork: () => {
      if (!ros) {
        return Promise.reject(new Error('Not connected to rosbridge'));
      }
      
      return new Promise((resolve, reject) => {
        const getServicesService = new ROSLIB.Service({
          ros: ros,
          name: '/rosapi/services',
          serviceType: 'rosapi_msgs/srv/Services'
        });

        const request = new ROSLIB.ServiceRequest({});
        
        getServicesService.callService(request, (result: any) => {
          resolve({
            services: result.services || [],
            target_drone: droneStatus.drone_name
          });
        }, (error: any) => {
          reject(new Error(`Network discovery failed: ${error}`));
        });
      });
    },

    getDroneServices: () => {
      return droneAPI.getNetwork().then((network: any) => {
        const droneServices = network.services.filter((s: string) => 
          s.startsWith(`/${droneStatus.drone_name}/`)
        );
        return {
          target_drone: droneStatus.drone_name,
          services: droneServices
        };
      });
    },

    // Discover available drones by scanning for get_state services
    discoverDrones: () => {
      if (!ros) {
        return Promise.reject(new Error('Not connected to rosbridge'));
      }
      
      return new Promise((resolve, reject) => {
        const getServicesService = new ROSLIB.Service({
          ros: ros,
          name: '/rosapi/services',
          serviceType: 'rosapi_msgs/srv/Services'
        });

        const request = new ROSLIB.ServiceRequest({});
        
        getServicesService.callService(request, (result: any) => {
          // Look for /droneX/get_state services to identify available drones
          const droneServices = result.services.filter((s: string) => 
            s.match(/^\/drone\d+\/get_state$/)
          );
          
          // Extract drone names (e.g., "drone1" from "/drone1/get_state")
          const discoveredDrones = droneServices.map((s: string) => 
            s.split('/')[1]
          ).sort((a: string, b: string) => {
            // Sort numerically (drone1, drone2, ..., drone10, ...)
            const aNum = parseInt(a.replace('drone', ''));
            const bNum = parseInt(b.replace('drone', ''));
            return aNum - bNum;
          });
          
          resolve(discoveredDrones);
        }, (error: any) => {
          reject(new Error(`Drone discovery failed: ${error}`));
        });
      });
    }
  }), [ros, droneStatus.drone_name]);
  
  // Helper function for Trigger services
  const callTriggerService = (serviceName: string) => {
    if (!ros) {
      return Promise.reject(new Error('Not connected to rosbridge'));
    }
    
    console.log('[DEBUG] Calling trigger service:', serviceName, 'for drone:', droneStatus.drone_name);
    
    return new Promise((resolve, reject) => {
      const fullServiceName = `/${droneStatus.drone_name}/${serviceName}`;
      const service = new ROSLIB.Service({
        ros: ros,
        name: fullServiceName,
        serviceType: 'std_srvs/srv/Trigger'
      });

      const request = new ROSLIB.ServiceRequest({});
      
      service.callService(request, (result: any) => {
        console.log('[DEBUG]', serviceName, 'response:', { success: result.success, message: result.message });
        resolve({ success: result.success, message: result.message });
        // Refresh state after command
        setTimeout(() => refreshDroneState(ros), 1000);
      }, (error: any) => {
        console.error('[DEBUG]', serviceName, 'failed:', error);
        reject(new Error(`${serviceName} failed: ${error}`));
      });
    });
  };

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
            <span className="status-label">Target:</span>
            <span className={`status-value ${droneStatus.connected ? 'status-connected' : 'status-disconnected'}`}>
              {droneStatus.drone_name.toUpperCase()}{droneStatus.connected ? ' ✓' : ' ✗'}
            </span>
          </div>
          
          <div className="status-section">
            <span className="status-label">Fleet:</span>
            <span className="status-value">{availableDrones.length} UNIT{availableDrones.length !== 1 ? 'S' : ''}</span>
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
              {/* MiniMap in its own container */}
              <div className="minimap-container">
                <MiniMap 
                  droneAPI={droneAPI}
                  droneStatus={droneStatus}
                  availableDrones={availableDrones}
                  unitSystem={unitSystem}
                />
              </div>
              
              {/* RuneScape-style menu */}
              <div className="right-menu">
                <RuneScapeMenu
                  droneAPI={droneAPI}
                  droneStatus={droneStatus}
                  unitSystem={unitSystem}
                  availableDrones={availableDrones}
                />
              </div>
            </div>
          </div>

          {/* Flight controls hotbar - separate component */}
          <div className="hotbar-container">
            <FlightControlsHotbar
              droneAPI={droneAPI}
              droneStatus={droneStatus}
              availableDrones={availableDrones}
              unitSystem={unitSystem}
            />
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
            ros={ros}
            isConnected={isConnected}
          />
        </main>
      )}

      {/* Bottom Status Bar */}
      <footer className="bottom-status-bar">
        <div className="status-bar-left">
          <span className="status-item">
            Target: {droneStatus.drone_name}
          </span>
          <span className="status-item">
            Mode: {droneStatus.flight_mode}
          </span>
          <span className="status-item">
            Pos: ({convertDistance(droneStatus.position.x, unitSystem).toFixed(1)}, {convertDistance(droneStatus.position.y, unitSystem).toFixed(1)}, {convertDistance(droneStatus.position.z, unitSystem).toFixed(1)}){getDistanceUnit(unitSystem)}
          </span>
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