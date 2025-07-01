import React, { useState, useEffect } from 'react';
import { DroneStatus, UnitSystem, convertDistance, getDistanceUnit } from '../App';

interface ManualControlsProps {
  droneAPI: any;
  droneStatus: DroneStatus;
  availableDrones: string[];
  unitSystem: UnitSystem;
}

const ManualControls: React.FC<ManualControlsProps> = ({ droneAPI, droneStatus, availableDrones, unitSystem }) => {
  const [isLoading, setIsLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [droneState, setDroneState] = useState<any>(null);
  
  // Position control state
  const [position, setPosition] = useState({
    x: 0,
    y: 0,
    z: -10, // Default altitude (negative for up in NED)
    yaw: 0
  });

  // Load drone state on mount
  useEffect(() => {
    const loadDroneState = async () => {
      try {
        if (droneAPI.ros) {  // Only if connected to rosbridge
          const state = await droneAPI.getState();
          setDroneState(state);
          
          if (state.success && state.state) {
            setMessage(`State loaded for ${droneStatus.drone_name}`);
          }
        }
      } catch (error) {
        setMessage(`Failed to load drone state: ${error instanceof Error ? error.message : 'Unknown error'}`);
      }
    };
    
    loadDroneState();
    // Refresh every 5 seconds
    const interval = setInterval(loadDroneState, 5000);
    return () => clearInterval(interval);
  }, [droneAPI, droneStatus.drone_name]);
  
  const executeCommand = async (command: () => Promise<any>, commandName: string) => {
    setIsLoading(true);
    setMessage('');
    
    try {
      const result = await command();
      setMessage(`${commandName}: ${result.message}`);
      
      // Refresh state after command
      setTimeout(async () => {
        try {
          const state = await droneAPI.getState();
          setDroneState(state);
        } catch (e) {
          // Ignore state refresh errors
        }
      }, 1000);
    } catch (error) {
      setMessage(`${commandName} failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    } finally {
      setIsLoading(false);
    }
  };
  
  const handlePositionSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    executeCommand(
      () => droneAPI.setPosition(position.x, position.y, position.z, position.yaw),
      `Set Position (${position.x}, ${position.y}, ${position.z}, ${position.yaw})`
    );
  };
  
  const changeTargetDrone = async (drone_name: string) => {
    setIsLoading(true);
    try {
      const result = await droneAPI.setTargetDrone(drone_name);
      setMessage(`Target changed to ${result.new_target}`);
    } catch (error) {
      setMessage(`Failed to change target: ${error instanceof Error ? error.message : 'Unknown error'}`);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div>
      <h2>Manual Controls</h2>
      
      {/* Target Drone Selection */}
      <div style={{ marginBottom: '2rem' }}>
        <h3>Target Drone</h3>
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
          {availableDrones.length > 0 ? (
            availableDrones.map(droneName => (
              <button
                key={droneName}
                className={`btn ${droneStatus.drone_name === droneName ? 'primary' : 'secondary'}`}
                onClick={() => changeTargetDrone(droneName)}
                disabled={isLoading}
              >
                {droneName}
              </button>
            ))
          ) : (
            <div style={{ color: '#888', fontStyle: 'italic' }}>
              No drones discovered yet...
            </div>
          )}
        </div>
        <div style={{ fontSize: '0.75rem', color: '#888', marginTop: '0.5rem' }}>
          Discovered {availableDrones.length} drone(s)
        </div>
      </div>
      
      {/* Current State Display */}
      {droneState?.success && droneState?.state && (
        <div style={{ marginBottom: '2rem' }}>
          <h3>Current State</h3>
          <div style={{ 
            padding: '0.75rem', 
            backgroundColor: '#2d4a2d', 
            borderRadius: '4px',
            fontSize: '0.875rem',
            border: '1px solid #00ff88'
          }}>
            <div><strong>Armed:</strong> {droneState.state.arming_state}</div>
            <div><strong>Flight Mode:</strong> {droneState.state.nav_state}</div>
            <div><strong>Landing State:</strong> {droneState.state.landing_state}</div>
            <div><strong>Position:</strong> ({convertDistance(droneState.state.local_x || 0, unitSystem).toFixed(2)}, {convertDistance(droneState.state.local_y || 0, unitSystem).toFixed(2)}, {convertDistance(droneState.state.local_z || 0, unitSystem).toFixed(2)}) {getDistanceUnit(unitSystem)}</div>
            <div><strong>Yaw:</strong> {(droneState.state.local_yaw || 0).toFixed(2)} rad</div>
          </div>
        </div>
      )}

      {/* Basic Commands */}
      <div style={{ marginBottom: '2rem' }}>
        <h3>Flight Commands</h3>
        
        <button
          className="btn secondary"
          onClick={() => executeCommand(droneAPI.setOffboard, 'Set Offboard')}
          disabled={isLoading}
        >
          Set Offboard Mode
        </button>

        <button
          className={`btn ${droneStatus.armed ? 'danger' : 'primary'}`}
          onClick={() => executeCommand(
            droneStatus.armed ? droneAPI.disarm : droneAPI.arm,
            droneStatus.armed ? 'Disarm' : 'Arm'
          )}
          disabled={isLoading}
        >
          {droneStatus.armed ? 'Disarm' : 'Arm'}
        </button>

        <button
          className="btn primary"
          onClick={() => executeCommand(droneAPI.takeoff, 'Takeoff')}
          disabled={isLoading || !droneStatus.armed}
        >
          Takeoff
        </button>

        <button
          className="btn danger"
          onClick={() => executeCommand(droneAPI.land, 'Land')}
          disabled={isLoading}
        >
          Land
        </button>
      </div>

      {/* Position Control */}
      <div style={{ marginBottom: '2rem' }}>
        <h3>Position Control</h3>
        <form onSubmit={handlePositionSubmit}>
          <div className="input-row">
            <div className="form-group">
              <label>X (North, {getDistanceUnit(unitSystem)})</label>
              <input
                type="number"
                step="0.1"
                value={position.x}
                onChange={(e) => setPosition({...position, x: parseFloat(e.target.value) || 0})}
              />
            </div>
            <div className="form-group">
              <label>Y (East, {getDistanceUnit(unitSystem)})</label>
              <input
                type="number"
                step="0.1"
                value={position.y}
                onChange={(e) => setPosition({...position, y: parseFloat(e.target.value) || 0})}
              />
            </div>
          </div>
          
          <div className="input-row">
            <div className="form-group">
              <label>Z (Down, {getDistanceUnit(unitSystem)})</label>
              <input
                type="number"
                step="0.1"
                value={position.z}
                onChange={(e) => setPosition({...position, z: parseFloat(e.target.value) || 0})}
                placeholder="Negative for altitude"
              />
            </div>
            <div className="form-group">
              <label>Yaw (rad)</label>
              <input
                type="number"
                step="0.1"
                value={position.yaw}
                onChange={(e) => setPosition({...position, yaw: parseFloat(e.target.value) || 0})}
              />
            </div>
          </div>
          
          <button
            type="submit"
            className="btn primary"
            disabled={isLoading}
          >
            Set Position
          </button>
        </form>
      </div>

      {/* Quick Altitude Controls */}
      <div style={{ marginBottom: '2rem' }}>
        <h3>Quick Commands</h3>
        
        <button
          className="btn secondary"
          onClick={() => executeCommand(
            () => droneAPI.setPosition(droneStatus.position.x, droneStatus.position.y, unitSystem === 'imperial' ? -16.4 : -5, droneStatus.position.yaw),
            `Go to ${unitSystem === 'imperial' ? '16ft' : '5m'} altitude`
          )}
          disabled={isLoading}
        >
          {unitSystem === 'imperial' ? '16ft' : '5m'} Altitude
        </button>

        <button
          className="btn secondary"
          onClick={() => executeCommand(
            () => droneAPI.setPosition(droneStatus.position.x, droneStatus.position.y, unitSystem === 'imperial' ? -32.8 : -10, droneStatus.position.yaw),
            `Go to ${unitSystem === 'imperial' ? '33ft' : '10m'} altitude`
          )}
          disabled={isLoading}
        >
          {unitSystem === 'imperial' ? '33ft' : '10m'} Altitude
        </button>

        <button
          className="btn secondary"
          onClick={() => executeCommand(
            () => droneAPI.setPosition(0, 0, droneStatus.position.z, 0),
            'Return to origin'
          )}
          disabled={isLoading}
        >
          Return to Origin
        </button>
      </div>

      {/* Status Message */}
      {message && (
        <div style={{
          padding: '0.75rem',
          marginTop: '1rem',
          backgroundColor: '#3d3d3d',
          borderRadius: '4px',
          fontSize: '0.875rem',
          color: message.includes('failed') ? '#ff4444' : '#00ff88'
        }}>
          {message}
        </div>
      )}

      {isLoading && (
        <div style={{
          padding: '0.75rem',
          marginTop: '1rem',
          backgroundColor: '#444',
          borderRadius: '4px',
          fontSize: '0.875rem',
          color: '#ccc'
        }}>
          Executing command...
        </div>
      )}
    </div>
  );
};

export default ManualControls;