import React, { useState } from 'react';
import { DroneStatus, UnitSystem } from '../App';

interface RuneScapeMenuProps {
  droneAPI: any;
  droneStatus: DroneStatus;
  unitSystem: UnitSystem;
  availableDrones: string[];
}

interface TabItem {
  id: string;
  label: string;
  icon: string;
  content: React.ReactNode;
}

const RuneScapeMenu: React.FC<RuneScapeMenuProps> = ({ droneAPI, droneStatus, availableDrones }) => {
  const [activeTab, setActiveTab] = useState<string>('stats');

  const tabs: TabItem[] = [
    {
      id: 'stats',
      label: 'Stats',
      icon: '📊',
      content: (
        <div className="tab-content">
          <h3>Drone Statistics</h3>
          <div className="stats-grid">
            <div className="stat-item">
              <span className="stat-label">Flight Time:</span>
              <span className="stat-value">0:00:00</span>
            </div>
            <div className="stat-item">
              <span className="stat-label">Total Distance:</span>
              <span className="stat-value">0.0m</span>
            </div>
            <div className="stat-item">
              <span className="stat-label">Max Altitude:</span>
              <span className="stat-value">{Math.abs(droneStatus.position.z).toFixed(1)}m</span>
            </div>
            <div className="stat-item">
              <span className="stat-label">Battery Cycles:</span>
              <span className="stat-value">--</span>
            </div>
            <div className="stat-item">
              <span className="stat-label">Successful Missions:</span>
              <span className="stat-value">--</span>
            </div>
            <div className="stat-item">
              <span className="stat-label">Emergency Landings:</span>
              <span className="stat-value">--</span>
            </div>
          </div>
        </div>
      )
    },
    {
      id: 'drones',
      label: 'Drones',
      icon: '🚁',
      content: (
        <div className="tab-content">
          <h3>Drone Fleet</h3>
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
          </div>
          
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
        <div className="tab-content">
          <h3>Mission Log</h3>
          <div className="mission-list">
            <div className="mission-item completed">
              <span className="mission-icon">✅</span>
              <div className="mission-details">
                <div className="mission-name">Test Flight #1</div>
                <div className="mission-time">2 hours ago</div>
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
                <div className="mission-name">Survey Mission</div>
                <div className="mission-time">Planned</div>
              </div>
            </div>
          </div>
        </div>
      )
    },
    {
      id: 'settings',
      label: 'Settings',
      icon: '⚙️',
      content: (
        <div className="tab-content">
          <h3>Drone Configuration</h3>
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
        </div>
      )
    },
    {
      id: 'skills',
      label: 'Abilities',
      icon: '🎯',
      content: (
        <div className="tab-content">
          <h3>Flight Capabilities</h3>
          <div className="skills-list">
            <div className="skill-item">
              <span className="skill-icon">🛫</span>
              <div className="skill-info">
                <div className="skill-name">Takeoff/Landing</div>
                <div className="skill-level">Level 99</div>
                <div className="skill-bar">
                  <div className="skill-progress" style={{width: '100%'}}></div>
                </div>
              </div>
            </div>
            <div className="skill-item">
              <span className="skill-icon">🎯</span>
              <div className="skill-info">
                <div className="skill-name">Precision Positioning</div>
                <div className="skill-level">Level 85</div>
                <div className="skill-bar">
                  <div className="skill-progress" style={{width: '85%'}}></div>
                </div>
              </div>
            </div>
            <div className="skill-item">
              <span className="skill-icon">🗺️</span>
              <div className="skill-info">
                <div className="skill-name">Autonomous Navigation</div>
                <div className="skill-level">Level 72</div>
                <div className="skill-bar">
                  <div className="skill-progress" style={{width: '72%'}}></div>
                </div>
              </div>
            </div>
            <div className="skill-item">
              <span className="skill-icon">🚁</span>
              <div className="skill-info">
                <div className="skill-name">Obstacle Avoidance</div>
                <div className="skill-level">Level 45</div>
                <div className="skill-bar">
                  <div className="skill-progress" style={{width: '45%'}}></div>
                </div>
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
        <div className="tab-content">
          <h3>AI Assistant</h3>
          <div className="ai-spells">
            <div className="spell-item available">
              <span className="spell-icon">🎯</span>
              <div className="spell-info">
                <div className="spell-name">Auto Target</div>
                <div className="spell-desc">Automatically track objects</div>
              </div>
            </div>
            <div className="spell-item available">
              <span className="spell-icon">🗺️</span>
              <div className="spell-info">
                <div className="spell-name">Route Planning</div>
                <div className="spell-desc">Optimize flight paths</div>
              </div>
            </div>
            <div className="spell-item locked">
              <span className="spell-icon">🚫</span>
              <div className="spell-info">
                <div className="spell-name">Swarm Control</div>
                <div className="spell-desc">Control multiple drones</div>
              </div>
            </div>
            <div className="spell-item locked">
              <span className="spell-icon">🚫</span>
              <div className="spell-info">
                <div className="spell-name">Weather Prediction</div>
                <div className="spell-desc">Forecast flight conditions</div>
              </div>
            </div>
          </div>
        </div>
      )
    }
  ];

  return (
    <div className="runescape-menu">
      <div className="menu-content">
        {tabs.find(tab => tab.id === activeTab)?.content}
      </div>
      
      <div className="menu-tabs">
        {tabs.map((tab) => (
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