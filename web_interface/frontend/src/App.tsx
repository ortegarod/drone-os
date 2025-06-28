import React, { useState, useEffect } from 'react';
// @ts-ignore
import ROSLIB from 'roslib';
import ManualControls from './components/ManualControls';
import AIInterface from './components/AIInterface';
import SimpleCameraFeed from './components/SimpleCameraFeed';
import TelemetryPage from './components/TelemetryPage';
import MiniMap from './components/MiniMap';
import DroneMap from './components/DroneMap';
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

const App: React.FC = () => {
  const [currentPage, setCurrentPage] = useState<'main' | 'telemetry' | 'map'>('main');
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

  // Initialize rosbridge connection
  useEffect(() => {
    const connectRosbridge = () => {
      const rosInstance = new ROSLIB.Ros({
        url: ROSBRIDGE_URL
      });

      rosInstance.on('connection', () => {
        console.log('Connected to rosbridge!');
        setIsConnected(true);
        setRos(rosInstance);
        
        // Get initial drone state
        refreshDroneState(rosInstance);
        
        // Discover available drones
        discoverAvailableDrones(rosInstance);
      });

      rosInstance.on('error', (error: any) => {
        console.error('rosbridge connection error:', error);
        setIsConnected(false);
      });

      rosInstance.on('close', () => {
        console.log('rosbridge connection closed');
        setIsConnected(false);
        setRos(null);
        // Attempt to reconnect after 3 seconds
        setTimeout(connectRosbridge, 3000);
      });
    };

    connectRosbridge();

    // Cleanup on unmount
    return () => {
      if (ros) {
        ros.close();
      }
    };
  }, []);
  
  // Function to refresh drone state
  const refreshDroneState = (rosInstance: any) => {
    const getStateService = new ROSLIB.Service({
      ros: rosInstance,
      name: `/${droneStatus.drone_name}/get_state`,
      serviceType: 'drone_interfaces/srv/GetState'
    });

    const request = new ROSLIB.ServiceRequest({});
    
    getStateService.callService(request, (result: any) => {
      if (result.success && result) {
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
          timestamp: Date.now()
        }));
      }
    }, (error: any) => {
      console.warn('Failed to get drone state:', error);
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
  
  // Periodic state refresh
  useEffect(() => {
    if (ros && isConnected) {
      const interval = setInterval(() => {
        refreshDroneState(ros);
      }, 2000); // Refresh every 2 seconds
      
      return () => clearInterval(interval);
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
      
      return new Promise((resolve, reject) => {
        const setPositionService = new ROSLIB.Service({
          ros: ros,
          name: `/${droneStatus.drone_name}/set_position`,
          serviceType: 'drone_interfaces/srv/SetPosition'
        });

        const request = new ROSLIB.ServiceRequest({ x, y, z, yaw });
        
        setPositionService.callService(request, (result: any) => {
          resolve({ success: result.success, message: result.message });
          // Refresh state after command
          setTimeout(() => refreshDroneState(ros), 1000);
        }, (error: any) => {
          reject(new Error(`SetPosition failed: ${error}`));
        });
      });
    },

    // Get drone state
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
          resolve({ success: result.success, message: result.message, state: result });
        }, (error: any) => {
          reject(new Error(`GetState failed: ${error}`));
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
    
    return new Promise((resolve, reject) => {
      const service = new ROSLIB.Service({
        ros: ros,
        name: `/${droneStatus.drone_name}/${serviceName}`,
        serviceType: 'std_srvs/srv/Trigger'
      });

      const request = new ROSLIB.ServiceRequest({});
      
      service.callService(request, (result: any) => {
        resolve({ success: result.success, message: result.message });
        // Refresh state after command
        setTimeout(() => refreshDroneState(ros), 1000);
      }, (error: any) => {
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
              Telemetry & Health
            </button>
            <button 
              className={`nav-btn ${currentPage === 'map' ? 'active' : ''}`}
              onClick={() => setCurrentPage('map')}
            >
              Drone Map
            </button>
          </nav>
        </div>
        <div className="connection-status">
          <span className={`status-indicator ${isConnected ? 'connected' : 'disconnected'}`}>
            {isConnected ? '🟢 Connected to rosbridge' : '🔴 Disconnected from rosbridge'}
          </span>
        </div>
      </header>

      {/* Top Status Bar */}
      <div className="top-status-bar">
        <div className="status-bar-left">
          <span className={`status-item armed-status ${droneStatus.armed ? 'armed' : 'disarmed'}`}>
            {droneStatus.armed ? '🔴 ARMED' : '🟢 DISARMED'}
          </span>
          <span className="status-item">
            Mode: {droneStatus.flight_mode}
          </span>
          <span className="status-item">
            Alt: {(-droneStatus.position.z).toFixed(1)}m
          </span>
        </div>
        
        <div className="status-bar-right">
          <span className="status-item">
            Last Update: {droneStatus.timestamp ? new Date(droneStatus.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : 'Never'}
          </span>
        </div>
      </div>

      {currentPage === 'main' ? (
        <main className="app-main">
          <div className="left-panel">
            <ManualControls 
              droneAPI={droneAPI}
              droneStatus={droneStatus}
              availableDrones={availableDrones}
            />
          </div>

          <div className="center-panel">
            <SimpleCameraFeed 
              droneAPI={droneAPI}
              isConnected={isConnected}
            />
          </div>

          <div className="right-panel">
            <AIInterface 
              droneAPI={droneAPI}
              droneStatus={droneStatus}
            />
          </div>
          
          {/* MiniMap overlay in top-right corner */}
          <MiniMap 
            droneAPI={droneAPI}
            droneStatus={droneStatus}
            availableDrones={availableDrones}
          />
        </main>
      ) : currentPage === 'telemetry' ? (
        <main style={{ flex: 1, overflow: 'hidden' }}>
          <TelemetryPage 
            droneAPI={droneAPI}
            droneStatus={droneStatus}
          />
        </main>
      ) : (
        <main style={{ flex: 1, overflow: 'hidden' }}>
          <DroneMap 
            droneAPI={droneAPI}
            droneStatus={droneStatus}
            availableDrones={availableDrones}
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
            Pos: ({droneStatus.position.x.toFixed(1)}, {droneStatus.position.y.toFixed(1)}, {droneStatus.position.z.toFixed(1)})
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