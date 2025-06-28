import React, { useState, useEffect } from 'react';
import { DroneStatus } from '../App';

interface TelemetryData {
  // Battery & Power
  battery_voltage: number;
  battery_current: number;
  battery_remaining: number;
  battery_time_remaining: number;
  battery_temperature: number;
  battery_warning: string;
  
  // GPS & Navigation
  gps_fix_type: string;
  gps_satellites_used: number;
  gps_hdop: number;
  gps_vdop: number;
  gps_accuracy_horizontal: number;
  gps_accuracy_vertical: number;
  
  // System Health
  system_health_score: number;
  active_warnings: string[];
  critical_failures: string[];
  component_status: Record<string, string>;
  
  // Communication
  rc_signal_strength: number;
  rc_signal_valid: boolean;
  telemetry_link_quality: number;
  gcs_connected: boolean;
  packet_loss_rate: number;
  
  // Flight Performance
  velocity_ned: [number, number, number];
  altitude_rate: number;
  wind_speed: number;
  wind_direction: number;
  
  // Mission Status
  mission_progress: number;
  current_waypoint: number;
  total_waypoints: number;
  distance_to_target: number;
  eta_to_target: number;
  
  // Safety Status
  geofence_status: string;
  flight_time_elapsed: number;
  flight_time_limit: number;
  
  timestamp: number;
}

interface Alert {
  id: string;
  level: 'info' | 'warning' | 'critical' | 'emergency';
  message: string;
  timestamp: number;
  acknowledged: boolean;
}

interface TelemetryPageProps {
  droneAPI: any;
  droneStatus: DroneStatus;
}

const TelemetryPage: React.FC<TelemetryPageProps> = ({ droneAPI, droneStatus }) => {
  const [telemetryData, setTelemetryData] = useState<TelemetryData | null>(null);
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [autoRefresh, setAutoRefresh] = useState(true);

  // Fetch comprehensive telemetry data
  const fetchTelemetryData = async () => {
    try {
      if (!droneAPI.ros) return;
      
      // This would call an extended telemetry service
      // For now, we'll simulate the data structure
      const mockTelemetryData: TelemetryData = {
        // Battery & Power (simulated - would come from battery_status topic)
        battery_voltage: 12.6,
        battery_current: 15.2,
        battery_remaining: droneStatus.battery / 100,
        battery_time_remaining: 1200, // seconds
        battery_temperature: 35.2,
        battery_warning: droneStatus.battery < 25 ? 'LOW' : 'NONE',
        
        // GPS & Navigation (simulated - would come from sensor_gps topic)
        gps_fix_type: '3D_FIX',
        gps_satellites_used: 12,
        gps_hdop: 0.8,
        gps_vdop: 1.2,
        gps_accuracy_horizontal: 1.5,
        gps_accuracy_vertical: 2.1,
        
        // System Health (simulated - would come from health monitoring service)
        system_health_score: 95,
        active_warnings: droneStatus.battery < 25 ? ['Low battery'] : [],
        critical_failures: [],
        component_status: {
          'Flight Controller': 'OK',
          'GPS': 'OK',
          'IMU': 'OK',
          'Magnetometer': 'OK',
          'Barometer': 'OK',
          'RC Receiver': 'OK',
          'Telemetry': 'OK'
        },
        
        // Communication (simulated - would come from telemetry_status topic)
        rc_signal_strength: 85,
        rc_signal_valid: true,
        telemetry_link_quality: 92,
        gcs_connected: true,
        packet_loss_rate: 0.02,
        
        // Flight Performance (simulated - would come from vehicle_local_position topic)
        velocity_ned: [0.5, -0.2, 0.1],
        altitude_rate: 0.05,
        wind_speed: 3.2,
        wind_direction: 180,
        
        // Mission Status (already available from our system)
        mission_progress: 0.65,
        current_waypoint: 3,
        total_waypoints: 8,
        distance_to_target: 25.7,
        eta_to_target: 45,
        
        // Safety Status (simulated - would come from various safety topics)
        geofence_status: 'INSIDE',
        flight_time_elapsed: 420,
        flight_time_limit: 1800,
        
        timestamp: Date.now()
      };
      
      setTelemetryData(mockTelemetryData);
      
      // Generate alerts based on telemetry data
      generateAlerts(mockTelemetryData);
      
    } catch (error) {
      console.error('Failed to fetch telemetry data:', error);
    } finally {
      setIsLoading(false);
    }
  };

  // Generate alerts based on telemetry data
  const generateAlerts = (data: TelemetryData) => {
    const newAlerts: Alert[] = [];
    
    // Battery alerts
    if (data.battery_remaining < 0.15) {
      newAlerts.push({
        id: 'battery_critical',
        level: 'critical',
        message: `Critical battery level: ${(data.battery_remaining * 100).toFixed(0)}%`,
        timestamp: Date.now(),
        acknowledged: false
      });
    } else if (data.battery_remaining < 0.25) {
      newAlerts.push({
        id: 'battery_low',
        level: 'warning',
        message: `Low battery: ${(data.battery_remaining * 100).toFixed(0)}%`,
        timestamp: Date.now(),
        acknowledged: false
      });
    }
    
    // GPS alerts
    if (data.gps_satellites_used < 6) {
      newAlerts.push({
        id: 'gps_satellites',
        level: 'warning',
        message: `Low satellite count: ${data.gps_satellites_used}`,
        timestamp: Date.now(),
        acknowledged: false
      });
    }
    
    // Communication alerts
    if (!data.rc_signal_valid) {
      newAlerts.push({
        id: 'rc_signal',
        level: 'critical',
        message: 'RC signal lost',
        timestamp: Date.now(),
        acknowledged: false
      });
    }
    
    if (data.packet_loss_rate > 0.05) {
      newAlerts.push({
        id: 'telemetry_loss',
        level: 'warning',
        message: `High packet loss: ${(data.packet_loss_rate * 100).toFixed(1)}%`,
        timestamp: Date.now(),
        acknowledged: false
      });
    }
    
    // Update alerts (merge with existing, don't duplicate)
    setAlerts(prevAlerts => {
      const existingIds = new Set(prevAlerts.map(a => a.id));
      const filteredNew = newAlerts.filter(a => !existingIds.has(a.id));
      return [...prevAlerts, ...filteredNew].slice(-20); // Keep last 20 alerts
    });
  };

  // Auto-refresh telemetry data
  useEffect(() => {
    fetchTelemetryData();
    
    if (autoRefresh) {
      const interval = setInterval(fetchTelemetryData, 2000); // Every 2 seconds
      return () => clearInterval(interval);
    }
  }, [droneAPI.ros, autoRefresh]);

  const acknowledgeAlert = (alertId: string) => {
    setAlerts(prev => prev.map(alert => 
      alert.id === alertId ? { ...alert, acknowledged: true } : alert
    ));
  };

  const getAlertLevelColor = (level: string) => {
    switch (level) {
      case 'emergency': return '#ff0000';
      case 'critical': return '#ff4444';
      case 'warning': return '#ff8800';
      case 'info': return '#0088ff';
      default: return '#ccc';
    }
  };

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  if (isLoading) {
    return (
      <div style={{ padding: '2rem', textAlign: 'center' }}>
        <div>Loading telemetry data...</div>
      </div>
    );
  }

  if (!telemetryData) {
    return (
      <div style={{ padding: '2rem', textAlign: 'center' }}>
        <div>No telemetry data available</div>
      </div>
    );
  }

  return (
    <div style={{ padding: '1rem', height: '100%', overflow: 'auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
        <h1>Telemetry & Health Monitor</h1>
        <div style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <input
              type="checkbox"
              checked={autoRefresh}
              onChange={(e) => setAutoRefresh(e.target.checked)}
            />
            Auto Refresh
          </label>
          <button 
            className="btn secondary"
            onClick={fetchTelemetryData}
            style={{ padding: '0.5rem 1rem' }}
          >
            Refresh Now
          </button>
        </div>
      </div>

      {/* Active Alerts */}
      {alerts.filter(a => !a.acknowledged).length > 0 && (
        <div style={{ marginBottom: '2rem' }}>
          <h2>🚨 Active Alerts</h2>
          <div style={{ display: 'grid', gap: '0.5rem' }}>
            {alerts.filter(a => !a.acknowledged).map(alert => (
              <div
                key={alert.id}
                style={{
                  padding: '0.75rem',
                  backgroundColor: 'rgba(0,0,0,0.3)',
                  border: `2px solid ${getAlertLevelColor(alert.level)}`,
                  borderRadius: '4px',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center'
                }}
              >
                <div>
                  <strong style={{ color: getAlertLevelColor(alert.level) }}>
                    {alert.level.toUpperCase()}
                  </strong>
                  : {alert.message}
                </div>
                <button
                  className="btn secondary"
                  onClick={() => acknowledgeAlert(alert.id)}
                  style={{ padding: '0.25rem 0.5rem', fontSize: '0.75rem' }}
                >
                  Acknowledge
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Telemetry Grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '1rem' }}>
        
        {/* Battery & Power */}
        <div className="telemetry-section">
          <h3>🔋 Battery & Power</h3>
          <div className="telemetry-grid">
            <div className="telemetry-item">
              <span className="label">Voltage:</span>
              <span className="value">{telemetryData.battery_voltage.toFixed(2)}V</span>
            </div>
            <div className="telemetry-item">
              <span className="label">Current:</span>
              <span className="value">{telemetryData.battery_current.toFixed(1)}A</span>
            </div>
            <div className="telemetry-item">
              <span className="label">Remaining:</span>
              <span className="value" style={{ 
                color: telemetryData.battery_remaining > 0.5 ? '#00ff88' : 
                       telemetryData.battery_remaining > 0.25 ? '#ff8800' : '#ff4444'
              }}>
                {(telemetryData.battery_remaining * 100).toFixed(0)}%
              </span>
            </div>
            <div className="telemetry-item">
              <span className="label">Flight Time Left:</span>
              <span className="value">{formatTime(telemetryData.battery_time_remaining)}</span>
            </div>
            <div className="telemetry-item">
              <span className="label">Temperature:</span>
              <span className="value">{telemetryData.battery_temperature.toFixed(1)}°C</span>
            </div>
            <div className="telemetry-item">
              <span className="label">Warning:</span>
              <span className="value" style={{ 
                color: telemetryData.battery_warning === 'NONE' ? '#00ff88' : '#ff4444'
              }}>
                {telemetryData.battery_warning}
              </span>
            </div>
          </div>
        </div>

        {/* GPS & Navigation */}
        <div className="telemetry-section">
          <h3>🛰️ GPS & Navigation</h3>
          <div className="telemetry-grid">
            <div className="telemetry-item">
              <span className="label">Fix Type:</span>
              <span className="value">{telemetryData.gps_fix_type}</span>
            </div>
            <div className="telemetry-item">
              <span className="label">Satellites:</span>
              <span className="value" style={{
                color: telemetryData.gps_satellites_used >= 8 ? '#00ff88' : 
                       telemetryData.gps_satellites_used >= 6 ? '#ff8800' : '#ff4444'
              }}>
                {telemetryData.gps_satellites_used}
              </span>
            </div>
            <div className="telemetry-item">
              <span className="label">HDOP:</span>
              <span className="value">{telemetryData.gps_hdop.toFixed(1)}</span>
            </div>
            <div className="telemetry-item">
              <span className="label">VDOP:</span>
              <span className="value">{telemetryData.gps_vdop.toFixed(1)}</span>
            </div>
            <div className="telemetry-item">
              <span className="label">H Accuracy:</span>
              <span className="value">{telemetryData.gps_accuracy_horizontal.toFixed(1)}m</span>
            </div>
            <div className="telemetry-item">
              <span className="label">V Accuracy:</span>
              <span className="value">{telemetryData.gps_accuracy_vertical.toFixed(1)}m</span>
            </div>
          </div>
        </div>

        {/* System Health */}
        <div className="telemetry-section">
          <h3>⚕️ System Health</h3>
          <div className="telemetry-grid">
            <div className="telemetry-item">
              <span className="label">Health Score:</span>
              <span className="value" style={{
                color: telemetryData.system_health_score >= 90 ? '#00ff88' : 
                       telemetryData.system_health_score >= 70 ? '#ff8800' : '#ff4444'
              }}>
                {telemetryData.system_health_score}%
              </span>
            </div>
            <div className="telemetry-item">
              <span className="label">Active Warnings:</span>
              <span className="value">{telemetryData.active_warnings.length}</span>
            </div>
            <div className="telemetry-item">
              <span className="label">Critical Failures:</span>
              <span className="value" style={{ color: telemetryData.critical_failures.length > 0 ? '#ff4444' : '#00ff88' }}>
                {telemetryData.critical_failures.length}
              </span>
            </div>
          </div>
          
          <h4 style={{ marginTop: '1rem', marginBottom: '0.5rem' }}>Component Status</h4>
          <div className="telemetry-grid">
            {Object.entries(telemetryData.component_status).map(([component, status]) => (
              <div key={component} className="telemetry-item">
                <span className="label">{component}:</span>
                <span className="value" style={{ color: status === 'OK' ? '#00ff88' : '#ff4444' }}>
                  {status}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* Communication */}
        <div className="telemetry-section">
          <h3>📡 Communication</h3>
          <div className="telemetry-grid">
            <div className="telemetry-item">
              <span className="label">RC Signal:</span>
              <span className="value" style={{ color: telemetryData.rc_signal_valid ? '#00ff88' : '#ff4444' }}>
                {telemetryData.rc_signal_strength}% {telemetryData.rc_signal_valid ? '✓' : '✗'}
              </span>
            </div>
            <div className="telemetry-item">
              <span className="label">Telemetry Link:</span>
              <span className="value">{telemetryData.telemetry_link_quality}%</span>
            </div>
            <div className="telemetry-item">
              <span className="label">GCS Connected:</span>
              <span className="value" style={{ color: telemetryData.gcs_connected ? '#00ff88' : '#ff4444' }}>
                {telemetryData.gcs_connected ? 'YES' : 'NO'}
              </span>
            </div>
            <div className="telemetry-item">
              <span className="label">Packet Loss:</span>
              <span className="value" style={{
                color: telemetryData.packet_loss_rate < 0.01 ? '#00ff88' : 
                       telemetryData.packet_loss_rate < 0.05 ? '#ff8800' : '#ff4444'
              }}>
                {(telemetryData.packet_loss_rate * 100).toFixed(1)}%
              </span>
            </div>
          </div>
        </div>

        {/* Flight Performance */}
        <div className="telemetry-section">
          <h3>🛩️ Flight Performance</h3>
          <div className="telemetry-grid">
            <div className="telemetry-item">
              <span className="label">Velocity (N):</span>
              <span className="value">{telemetryData.velocity_ned[0].toFixed(1)} m/s</span>
            </div>
            <div className="telemetry-item">
              <span className="label">Velocity (E):</span>
              <span className="value">{telemetryData.velocity_ned[1].toFixed(1)} m/s</span>
            </div>
            <div className="telemetry-item">
              <span className="label">Velocity (D):</span>
              <span className="value">{telemetryData.velocity_ned[2].toFixed(1)} m/s</span>
            </div>
            <div className="telemetry-item">
              <span className="label">Altitude Rate:</span>
              <span className="value">{telemetryData.altitude_rate.toFixed(2)} m/s</span>
            </div>
            <div className="telemetry-item">
              <span className="label">Wind Speed:</span>
              <span className="value">{telemetryData.wind_speed.toFixed(1)} m/s</span>
            </div>
            <div className="telemetry-item">
              <span className="label">Wind Direction:</span>
              <span className="value">{telemetryData.wind_direction}°</span>
            </div>
          </div>
        </div>

        {/* Mission Status */}
        <div className="telemetry-section">
          <h3>🎯 Mission Status</h3>
          <div className="telemetry-grid">
            <div className="telemetry-item">
              <span className="label">Progress:</span>
              <span className="value">{(telemetryData.mission_progress * 100).toFixed(0)}%</span>
            </div>
            <div className="telemetry-item">
              <span className="label">Current WP:</span>
              <span className="value">{telemetryData.current_waypoint}</span>
            </div>
            <div className="telemetry-item">
              <span className="label">Total WPs:</span>
              <span className="value">{telemetryData.total_waypoints}</span>
            </div>
            <div className="telemetry-item">
              <span className="label">Distance to Target:</span>
              <span className="value">{telemetryData.distance_to_target.toFixed(1)}m</span>
            </div>
            <div className="telemetry-item">
              <span className="label">ETA:</span>
              <span className="value">{formatTime(telemetryData.eta_to_target)}</span>
            </div>
          </div>
        </div>

        {/* Safety Status */}
        <div className="telemetry-section">
          <h3>🛡️ Safety Status</h3>
          <div className="telemetry-grid">
            <div className="telemetry-item">
              <span className="label">Geofence:</span>
              <span className="value" style={{ 
                color: telemetryData.geofence_status === 'INSIDE' ? '#00ff88' : '#ff4444'
              }}>
                {telemetryData.geofence_status}
              </span>
            </div>
            <div className="telemetry-item">
              <span className="label">Flight Time:</span>
              <span className="value">{formatTime(telemetryData.flight_time_elapsed)}</span>
            </div>
            <div className="telemetry-item">
              <span className="label">Time Limit:</span>
              <span className="value">{formatTime(telemetryData.flight_time_limit)}</span>
            </div>
            <div className="telemetry-item">
              <span className="label">Time Remaining:</span>
              <span className="value" style={{
                color: (telemetryData.flight_time_limit - telemetryData.flight_time_elapsed) > 300 ? '#00ff88' : '#ff8800'
              }}>
                {formatTime(telemetryData.flight_time_limit - telemetryData.flight_time_elapsed)}
              </span>
            </div>
          </div>
        </div>

      </div>

      {/* Alert History */}
      {alerts.length > 0 && (
        <div style={{ marginTop: '2rem' }}>
          <h2>📋 Alert History</h2>
          <div style={{ maxHeight: '300px', overflow: 'auto' }}>
            {alerts.slice().reverse().map(alert => (
              <div
                key={`${alert.id}-${alert.timestamp}`}
                style={{
                  padding: '0.5rem',
                  marginBottom: '0.5rem',
                  backgroundColor: alert.acknowledged ? '#2d2d2d' : 'rgba(0,0,0,0.3)',
                  border: `1px solid ${getAlertLevelColor(alert.level)}`,
                  borderRadius: '4px',
                  opacity: alert.acknowledged ? 0.7 : 1
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div>
                    <strong style={{ color: getAlertLevelColor(alert.level) }}>
                      {alert.level.toUpperCase()}
                    </strong>
                    : {alert.message}
                  </div>
                  <div style={{ fontSize: '0.75rem', color: '#888' }}>
                    {new Date(alert.timestamp).toLocaleTimeString()}
                    {alert.acknowledged && ' (ACK)'}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

export default TelemetryPage;