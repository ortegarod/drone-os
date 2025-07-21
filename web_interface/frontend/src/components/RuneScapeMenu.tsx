import React, { useState, useEffect } from 'react';
import { DroneStatus, UnitSystem } from '../App';

interface RuneScapeMenuProps {
  droneAPI: any;
  droneStatus: DroneStatus;
  unitSystem: UnitSystem;
  availableDrones: string[];
  isConnected: boolean;
}

interface TabItem {
  id: string;
  label: string;
  icon: string;
  content: React.ReactNode;
}

const RuneScapeMenu: React.FC<RuneScapeMenuProps> = ({ droneAPI, droneStatus, availableDrones, isConnected }) => {
  const [activeTab, setActiveTab] = useState<string>('stats');
  const [isLoading, setIsLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [showPositionControls, setShowPositionControls] = useState(false);
  const [position, setPosition] = useState({
    x: 0,
    y: 0,
    z: -10,
    yaw: 0
  });
  
  // Keyboard control state
  const [currentYaw, setCurrentYaw] = useState(0);
  const [currentAltitude, setCurrentAltitude] = useState(-10);
  const [isControlling, setIsControlling] = useState(false);
  const [controlMessage, setControlMessage] = useState('');

  const executeFlightCommand = async (command: () => Promise<any>, commandName: string) => {
    setIsLoading(true);
    setMessage('');
    
    try {
      const result = await command();
      setMessage(`${commandName}: ${result.success ? 'Success' : 'Failed'} - ${result.message}`);
    } catch (error) {
      setMessage(`${commandName} failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    } finally {
      setIsLoading(false);
    }
  };

  const handlePositionSet = async () => {
    await executeFlightCommand(
      () => droneAPI.setPosition(position.x, position.y, position.z, position.yaw),
      'Set Position'
    );
  };

  // Keyboard control functions (moved from SimpleCameraFeed)
  const adjustYaw = async (deltaYawDegrees: number) => {
    if (isControlling || !isConnected) return;
    
    setIsControlling(true);
    const newYaw = currentYaw + (deltaYawDegrees * Math.PI / 180); // Convert to radians
    setCurrentYaw(newYaw);
    
    try {
      const result = await droneAPI.setPosition(
        droneStatus.position.x,
        droneStatus.position.y,
        currentAltitude,
        newYaw
      );
      setControlMessage(`Yaw ${deltaYawDegrees > 0 ? '+' : ''}${deltaYawDegrees}°: ${result.success ? 'OK' : 'FAILED'}`);
    } catch (error) {
      setControlMessage(`Yaw control failed: ${error}`);
    } finally {
      setIsControlling(false);
    }
  };

  const adjustAltitude = async (deltaAltitudeMeters: number) => {
    if (isControlling || !isConnected) return;
    
    setIsControlling(true);
    const newAltitude = currentAltitude + deltaAltitudeMeters;
    setCurrentAltitude(newAltitude);
    
    try {
      const result = await droneAPI.setPosition(
        droneStatus.position.x,
        droneStatus.position.y,
        newAltitude,
        currentYaw
      );
      setControlMessage(`Altitude ${deltaAltitudeMeters > 0 ? '+' : ''}${deltaAltitudeMeters}m: ${result.success ? 'OK' : 'FAILED'}`);
    } catch (error) {
      setControlMessage(`Altitude control failed: ${error}`);
    } finally {
      setIsControlling(false);
    }
  };

  // Keyboard event handler
  const handleKeyPress = (event: KeyboardEvent) => {
    if (!isConnected || activeTab !== 'controls') return;
    
    switch (event.key.toLowerCase()) {
      case 'a':
      case 'arrowleft':
        event.preventDefault();
        adjustYaw(-15); // 15 degrees left
        break;
      case 'd':
      case 'arrowright':
        event.preventDefault();
        adjustYaw(15); // 15 degrees right
        break;
      case 'q':
        event.preventDefault();
        adjustYaw(-45); // 45 degrees left
        break;
      case 'e':
        event.preventDefault();
        adjustYaw(45); // 45 degrees right
        break;
      case 'w':
      case 'arrowup':
        event.preventDefault();
        adjustAltitude(2); // 2 meters up
        break;
      case 's':
      case 'arrowdown':
        event.preventDefault();
        adjustAltitude(-2); // 2 meters down
        break;
      case 'r':
        event.preventDefault();
        adjustAltitude(5); // 5 meters up
        break;
      case 'f':
        event.preventDefault();
        adjustAltitude(-5); // 5 meters down
        break;
    }
  };

  // Add keyboard listeners only when Controls tab is active
  useEffect(() => {
    if (activeTab === 'controls' && isConnected) {
      window.addEventListener('keydown', handleKeyPress);
      return () => window.removeEventListener('keydown', handleKeyPress);
    }
  }, [activeTab, isConnected, currentYaw, currentAltitude, isControlling]);

  // Top row tabs
  const topTabs: TabItem[] = [
    {
      id: 'stats',
      label: 'Stats',
      icon: '📊',
      content: (
        <div className="stats-grid">
          <div className="stat-item">
            <span className="stat-label">Flight Time:</span>
            <span className="stat-value">[PLACEHOLDER] 0:00:00</span>
          </div>
          <div className="stat-item">
            <span className="stat-label">Total Distance:</span>
            <span className="stat-value">[PLACEHOLDER] 0.0m</span>
          </div>
          <div className="stat-item">
            <span className="stat-label">Current Altitude:</span>
            <span className="stat-value">{Math.abs(droneStatus.position.z).toFixed(1)}m</span>
          </div>
          <div className="stat-item">
            <span className="stat-label">Battery Cycles:</span>
            <span className="stat-value">[PLACEHOLDER] --</span>
          </div>
          <div className="stat-item">
            <span className="stat-label">Successful Missions:</span>
            <span className="stat-value">[PLACEHOLDER] --</span>
          </div>
          <div className="stat-item">
            <span className="stat-label">Emergency Landings:</span>
            <span className="stat-value">[PLACEHOLDER] --</span>
          </div>
        </div>
      )
    },
    {
      id: 'drones',
      label: 'Drones',
      icon: '🚁',
      content: (
        <div className="drone-list">
          {/* Current target drone */}
          <div className={`drone-item ${droneStatus.drone_name === droneStatus.drone_name ? 'current-target' : ''}`}>
            <div className="drone-header">
              <span className="drone-icon">🎯</span>
              <div className="drone-info">
                <div className="drone-name">{droneStatus.drone_name}</div>
                <div className="drone-subtitle">Current Target</div>
              </div>
              <div className={`drone-status ${droneStatus.connected ? 'online' : 'offline'}`}>
                {droneStatus.connected ? '🟢 ONLINE' : '🔴 OFFLINE'}
              </div>
            </div>
            <div className="drone-details">
              <div className="drone-stat">
                <span className="stat-label">Armed:</span>
                <span className={`stat-value ${droneStatus.armed ? 'armed' : 'disarmed'}`}>
                  {droneStatus.armed ? 'ARMED' : 'DISARMED'}
                </span>
              </div>
              <div className="drone-stat">
                <span className="stat-label">Mode:</span>
                <span className="stat-value">{droneStatus.flight_mode}</span>
              </div>
              <div className="drone-stat">
                <span className="stat-label">Battery:</span>
                <span className={`stat-value ${droneStatus.battery > 50 ? 'good' : droneStatus.battery > 25 ? 'warning' : 'critical'}`}>
                  {droneStatus.battery}%
                </span>
              </div>
              <div className="drone-stat">
                <span className="stat-label">Position:</span>
                <span className="stat-value">
                  {droneStatus.position.x.toFixed(1)}, {droneStatus.position.y.toFixed(1)}, {Math.abs(droneStatus.position.z).toFixed(1)}m
                </span>
              </div>
            </div>
            <div className="drone-actions">
              <button 
                className="drone-action-btn primary"
                onClick={() => droneAPI.setTargetDrone(droneStatus.drone_name)}
                disabled={true}
              >
                ✓ SELECTED
              </button>
            </div>
          </div>

          {/* Other available drones */}
          {availableDrones
            .filter(drone => drone !== droneStatus.drone_name)
            .map(drone => (
              <div key={drone} className="drone-item">
                <div className="drone-header">
                  <span className="drone-icon">🚁</span>
                  <div className="drone-info">
                    <div className="drone-name">{drone}</div>
                    <div className="drone-subtitle">Available</div>
                  </div>
                  <div className="drone-status offline">
                    🔴 OFFLINE
                  </div>
                </div>
                <div className="drone-details">
                  <div className="drone-stat">
                    <span className="stat-label">Last Seen:</span>
                    <span className="stat-value">Unknown</span>
                  </div>
                  <div className="drone-stat">
                    <span className="stat-label">Status:</span>
                    <span className="stat-value">Standby</span>
                  </div>
                </div>
                <div className="drone-actions">
                  <button 
                    className="drone-action-btn secondary"
                    onClick={() => droneAPI.setTargetDrone(drone)}
                  >
                    SELECT
                  </button>
                </div>
              </div>
            ))
          }
          
          <div className="fleet-summary">
            <div className="summary-stat">
              <span className="summary-label">Total Drones:</span>
              <span className="summary-value">{availableDrones.length}</span>
            </div>
            <div className="summary-stat">
              <span className="summary-label">Online:</span>
              <span className="summary-value">{droneStatus.connected ? '1' : '0'}</span>
            </div>
            <div className="summary-stat">
              <span className="summary-label">Armed:</span>
              <span className="summary-value">{droneStatus.armed ? '1' : '0'}</span>
            </div>
          </div>
        </div>
      )
    },
    {
      id: 'missions',
      label: 'Missions',
      icon: '📋',
      content: (
        <div className="mission-list">
          <div className="mission-item completed">
            <span className="mission-icon">✅</span>
            <div className="mission-details">
              <div className="mission-name">[PLACEHOLDER] Test Flight #1</div>
              <div className="mission-time">[PLACEHOLDER] 2 hours ago</div>
            </div>
          </div>
          <div className="mission-item in-progress">
            <span className="mission-icon">🔄</span>
            <div className="mission-details">
              <div className="mission-name">Current Session</div>
              <div className="mission-time">Active</div>
            </div>
          </div>
          <div className="mission-item planned">
            <span className="mission-icon">📅</span>
            <div className="mission-details">
              <div className="mission-name">[PLACEHOLDER] Survey Mission</div>
              <div className="mission-time">[PLACEHOLDER] Planned</div>
            </div>
          </div>
        </div>
      )
    }
  ];

  // Bottom row tabs
  const bottomTabs: TabItem[] = [
    {
      id: 'controls',
      label: 'Controls',
      icon: '🎮',
      content: (
        <div className="controls-panel">
          {/* Flight Controls Section */}
          <div className="controls-section">
            <h4>Flight Controls</h4>
            <div className="controls-grid">
              <button
                className="control-btn btn-info"
                onClick={() => executeFlightCommand(() => droneAPI.setOffboard(), 'Set Offboard')}
                disabled={isLoading}
              >
                OFFBOARD
              </button>
              <button
                className="control-btn btn-warning"
                onClick={() => executeFlightCommand(() => droneAPI.arm(), 'Arm')}
                disabled={droneStatus.armed || isLoading}
              >
                ARM
              </button>
              <button
                className="control-btn btn-success"
                onClick={() => executeFlightCommand(() => droneAPI.takeoff(), 'Takeoff')}
                disabled={!droneStatus.armed || isLoading}
              >
                TAKEOFF
              </button>
              <button
                className="control-btn btn-primary"
                onClick={() => executeFlightCommand(() => droneAPI.land(), 'Land')}
                disabled={!droneStatus.armed || isLoading}
              >
                LAND
              </button>
              <button
                className="control-btn btn-info"
                onClick={() => executeFlightCommand(() => droneAPI.returnToLaunch(), 'Return to Launch')}
                disabled={!droneStatus.armed || isLoading}
              >
                RTL
              </button>
              <button
                className="control-btn btn-secondary"
                onClick={() => executeFlightCommand(() => droneAPI.disarm(), 'Disarm')}
                disabled={!droneStatus.armed || isLoading}
              >
                DISARM
              </button>
              <button
                className="control-btn btn-danger"
                onClick={() => executeFlightCommand(() => droneAPI.flightTermination(), 'Flight Termination')}
                disabled={isLoading}
              >
                EMERGENCY
              </button>
            </div>
          </div>

          {/* Quick Position Presets */}
          <div className="controls-section">
            <h4>Quick Positions</h4>
            <div className="controls-grid">
              <button
                className="control-btn btn-info"
                onClick={() => executeFlightCommand(() => droneAPI.setPosition(0, 0, -5, 0), 'Home Position')}
                disabled={isLoading}
              >
                HOME (0,0,-5m)
              </button>
              <button
                className="control-btn btn-info"
                onClick={() => executeFlightCommand(() => droneAPI.setPosition(0, 0, -10, 0), 'High Altitude')}
                disabled={isLoading}
              >
                HIGH ALT (-10m)
              </button>
              <button
                className="control-btn btn-info"
                onClick={() => executeFlightCommand(() => droneAPI.setPosition(0, 0, -2, 0), 'Low Altitude')}
                disabled={isLoading}
              >
                LOW ALT (-2m)
              </button>
            </div>
          </div>

          {/* Real-time Keyboard Controls */}
          <div className="controls-section">
            <h4>Keyboard Controls</h4>
            <div style={{ marginBottom: '0.5rem' }}>
              <div style={{ 
                fontSize: '0.65rem', 
                color: isConnected && activeTab === 'controls' ? '#00ff88' : '#ff8800',
                fontWeight: 600,
                marginBottom: '0.3rem'
              }}>
                {isConnected && activeTab === 'controls' ? '✓ ACTIVE' : '⚠ Controls tab must be active'}
              </div>
              <div style={{ fontSize: '0.6rem', color: '#888' }}>
                Current: Yaw {(currentYaw * 180 / Math.PI).toFixed(1)}° | Alt {currentAltitude.toFixed(1)}m
              </div>
            </div>
            
            <div className="keybinding-list">
              <div className="keybinding-item">
                <span className="key">Q/A/D/E</span>
                <span className="action">Yaw: -45°/-15°/+15°/+45°</span>
              </div>
              <div className="keybinding-item">
                <span className="key">W/S</span>
                <span className="action">Altitude: +2m/-2m</span>
              </div>
              <div className="keybinding-item">
                <span className="key">R/F</span>
                <span className="action">Altitude: +5m/-5m</span>
              </div>
              <div className="keybinding-item">
                <span className="key">Arrows</span>
                <span className="action">← → ↑ ↓ (same as A/D/W/S)</span>
              </div>
            </div>
          </div>

          {/* Manual Position Input */}
          <div className="controls-section">
            <h4>Manual Position</h4>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem' }}>
              <button
                className={`control-btn btn-secondary ${showPositionControls ? 'active' : ''}`}
                onClick={() => setShowPositionControls(!showPositionControls)}
                disabled={isLoading}
                style={{ fontSize: '0.65rem', padding: '0.3rem 0.6rem' }}
              >
                {showPositionControls ? 'HIDE' : 'SHOW'}
              </button>
            </div>

            {showPositionControls && (
              <div style={{ display: 'flex', gap: '0.3rem', marginBottom: '0.5rem', flexWrap: 'wrap' }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.1rem' }}>
                  <label style={{ fontSize: '0.6rem', color: '#888', fontWeight: 700, textTransform: 'uppercase' }}>X</label>
                  <input
                    type="number"
                    value={position.x}
                    onChange={(e) => setPosition({...position, x: parseFloat(e.target.value) || 0})}
                    step="0.1"
                    style={{
                      width: '45px',
                      padding: '0.2rem',
                      backgroundColor: '#1a1a1a',
                      color: '#fff',
                      border: '1px solid #444',
                      borderRadius: '3px',
                      fontSize: '0.65rem',
                      textAlign: 'center'
                    }}
                  />
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.1rem' }}>
                  <label style={{ fontSize: '0.6rem', color: '#888', fontWeight: 700, textTransform: 'uppercase' }}>Y</label>
                  <input
                    type="number"
                    value={position.y}
                    onChange={(e) => setPosition({...position, y: parseFloat(e.target.value) || 0})}
                    step="0.1"
                    style={{
                      width: '45px',
                      padding: '0.2rem',
                      backgroundColor: '#1a1a1a',
                      color: '#fff',
                      border: '1px solid #444',
                      borderRadius: '3px',
                      fontSize: '0.65rem',
                      textAlign: 'center'
                    }}
                  />
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.1rem' }}>
                  <label style={{ fontSize: '0.6rem', color: '#888', fontWeight: 700, textTransform: 'uppercase' }}>Z</label>
                  <input
                    type="number"
                    value={position.z}
                    onChange={(e) => setPosition({...position, z: parseFloat(e.target.value) || 0})}
                    step="0.1"
                    style={{
                      width: '45px',
                      padding: '0.2rem',
                      backgroundColor: '#1a1a1a',
                      color: '#fff',
                      border: '1px solid #444',
                      borderRadius: '3px',
                      fontSize: '0.65rem',
                      textAlign: 'center'
                    }}
                  />
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.1rem' }}>
                  <label style={{ fontSize: '0.6rem', color: '#888', fontWeight: 700, textTransform: 'uppercase' }}>YAW</label>
                  <input
                    type="number"
                    value={position.yaw}
                    onChange={(e) => setPosition({...position, yaw: parseFloat(e.target.value) || 0})}
                    step="0.1"
                    style={{
                      width: '45px',
                      padding: '0.2rem',
                      backgroundColor: '#1a1a1a',
                      color: '#fff',
                      border: '1px solid #444',
                      borderRadius: '3px',
                      fontSize: '0.65rem',
                      textAlign: 'center'
                    }}
                  />
                </div>
                <div style={{ display: 'flex', alignItems: 'end' }}>
                  <button
                    className="control-btn btn-primary"
                    onClick={handlePositionSet}
                    disabled={isLoading}
                    style={{ fontSize: '0.65rem', padding: '0.3rem 0.6rem' }}
                  >
                    GO
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Status Messages */}
          {(message || controlMessage) && (
            <div className="controls-section">
              <h4>Status</h4>
              {message && (
                <div style={{
                  padding: '0.3rem 0.5rem',
                  backgroundColor: '#1a1a1a',
                  border: '1px solid #333',
                  borderRadius: '3px',
                  fontSize: '0.65rem',
                  color: '#ccc',
                  marginBottom: '0.3rem',
                  fontFamily: 'monospace'
                }}>
                  {message}
                </div>
              )}
              {controlMessage && (
                <div style={{
                  padding: '0.3rem 0.5rem',
                  backgroundColor: '#1a1a1a',
                  border: '1px solid #444',
                  borderRadius: '3px',
                  fontSize: '0.65rem',
                  color: '#00ff88',
                  fontFamily: 'monospace'
                }}>
                  {controlMessage}
                </div>
              )}
            </div>
          )}
        </div>
      )
    },
    {
      id: 'settings',
      label: 'Settings',
      icon: '⚙️',
      content: (
        <div className="settings-list">
          <div className="setting-item">
            <label>Max Speed:</label>
            <input type="number" defaultValue="15" min="1" max="25" />
            <span>m/s</span>
          </div>
          <div className="setting-item">
            <label>Return Home Alt:</label>
            <input type="number" defaultValue="50" min="10" max="120" />
            <span>m</span>
          </div>
          <div className="setting-item">
            <label>Battery Warning:</label>
            <input type="number" defaultValue="25" min="10" max="50" />
            <span>%</span>
          </div>
          <div className="setting-item">
            <label>Auto Land:</label>
            <input type="checkbox" defaultChecked />
          </div>
          <div className="setting-item">
            <label>Geofence:</label>
            <input type="checkbox" defaultChecked />
          </div>
          <div className="setting-item">
            <label>Obstacle Avoidance:</label>
            <input type="checkbox" />
          </div>
        </div>
      )
    },
    {
      id: 'skills',
      label: 'Plugins',
      icon: '🎯',
      content: (
        <div className="skills-list">
          <div className="skill-item">
            <span className="skill-icon">🛫</span>
            <div className="skill-info">
              <div className="skill-name">[PLACEHOLDER] Takeoff/Landing</div>
              <div className="skill-level">[PLACEHOLDER] Level 99</div>
              <div className="skill-bar">
                <div className="skill-progress" style={{width: '100%'}}></div>
              </div>
            </div>
          </div>
          <div className="skill-item">
            <span className="skill-icon">🎯</span>
            <div className="skill-info">
              <div className="skill-name">[PLACEHOLDER] Precision Positioning</div>
              <div className="skill-level">[PLACEHOLDER] Level 85</div>
              <div className="skill-bar">
                <div className="skill-progress" style={{width: '85%'}}></div>
              </div>
            </div>
          </div>
          <div className="skill-item">
            <span className="skill-icon">🗺️</span>
            <div className="skill-info">
              <div className="skill-name">[PLACEHOLDER] Autonomous Navigation</div>
              <div className="skill-level">[PLACEHOLDER] Level 72</div>
              <div className="skill-bar">
                <div className="skill-progress" style={{width: '72%'}}></div>
              </div>
            </div>
          </div>
          <div className="skill-item">
            <span className="skill-icon">🚁</span>
            <div className="skill-info">
              <div className="skill-name">[PLACEHOLDER] Obstacle Avoidance</div>
              <div className="skill-level">[PLACEHOLDER] Level 45</div>
              <div className="skill-bar">
                <div className="skill-progress" style={{width: '45%'}}></div>
              </div>
            </div>
          </div>
        </div>
      )
    },
    {
      id: 'magic',
      label: 'AI',
      icon: '🧙',
      content: (
        <div className="ai-spells">
          <div className="spell-item locked">
            <span className="spell-icon">🚫</span>
            <div className="spell-info">
              <div className="spell-name">[PLACEHOLDER] Auto Target</div>
              <div className="spell-desc">[PLACEHOLDER] Automatically track objects</div>
            </div>
          </div>
          <div className="spell-item locked">
            <span className="spell-icon">🚫</span>
            <div className="spell-info">
              <div className="spell-name">[PLACEHOLDER] Route Planning</div>
              <div className="spell-desc">[PLACEHOLDER] Optimize flight paths</div>
            </div>
          </div>
          <div className="spell-item locked">
            <span className="spell-icon">🚫</span>
            <div className="spell-info">
              <div className="spell-name">[PLACEHOLDER] Swarm Control</div>
              <div className="spell-desc">[PLACEHOLDER] Control multiple drones</div>
            </div>
          </div>
          <div className="spell-item locked">
            <span className="spell-icon">🚫</span>
            <div className="spell-info">
              <div className="spell-name">[PLACEHOLDER] Weather Prediction</div>
              <div className="spell-desc">[PLACEHOLDER] Forecast flight conditions</div>
            </div>
          </div>
        </div>
      )
    }
  ];

  // Combine all tabs for lookup
  const allTabs = [...topTabs, ...bottomTabs];

  const activeTabData = allTabs.find(tab => tab.id === activeTab);

  return (
    <div className="runescape-menu">
      {/* Top Tabs */}
      <div className="menu-tabs-top">
        {topTabs.map((tab) => (
          <button
            key={tab.id}
            className={`menu-tab ${activeTab === tab.id ? 'active' : ''}`}
            onClick={() => setActiveTab(tab.id)}
            title={tab.label}
          >
            <span className="tab-icon">{tab.icon}</span>
            <span className="tab-label">{tab.label}</span>
          </button>
        ))}
      </div>

      {/* Content Window */}
      <div className="menu-content-window">
        {/* Header */}
        <div className="menu-content-header">
          <h3>{activeTabData?.label || 'Unknown'}</h3>
        </div>
        
        {/* Scrollable Content */}
        <div className="menu-content-body">
          {activeTabData?.content}
        </div>
      </div>

      {/* Bottom Tabs */}
      <div className="menu-tabs-bottom">
        {bottomTabs.map((tab) => (
          <button
            key={tab.id}
            className={`menu-tab ${activeTab === tab.id ? 'active' : ''}`}
            onClick={() => setActiveTab(tab.id)}
            title={tab.label}
          >
            <span className="tab-icon">{tab.icon}</span>
            <span className="tab-label">{tab.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
};

export default RuneScapeMenu;