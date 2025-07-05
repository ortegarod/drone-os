import React, { useState } from 'react';
import { DroneStatus, UnitSystem, convertDistance, getDistanceUnit } from '../App';

interface FlightControlsHotbarProps {
  droneAPI: any;
  droneStatus: DroneStatus;
  availableDrones: string[];
  unitSystem: UnitSystem;
}

const FlightControlsHotbar: React.FC<FlightControlsHotbarProps> = ({ 
  droneAPI, 
  droneStatus, 
  availableDrones, 
  unitSystem 
}) => {
  const [isLoading, setIsLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [position, setPosition] = useState({
    x: 0,
    y: 0,
    z: -10,
    yaw: 0
  });
  const [showPositionControls, setShowPositionControls] = useState(false);

  const executeCommand = async (command: () => Promise<any>, commandName: string) => {
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
    await executeCommand(
      () => droneAPI.setPosition(position.x, position.y, position.z, position.yaw),
      'Set Position'
    );
  };

  const quickCommands = [
    { 
      id: 'arm', 
      label: 'ARM', 
      icon: '🔓',
      action: () => executeCommand(() => droneAPI.arm(), 'Arm'),
      variant: 'warning',
      disabled: droneStatus.armed
    },
    { 
      id: 'disarm', 
      label: 'DISARM', 
      icon: '🔒',
      action: () => executeCommand(() => droneAPI.disarm(), 'Disarm'),
      variant: 'secondary',
      disabled: !droneStatus.armed
    },
    { 
      id: 'takeoff', 
      label: 'TAKEOFF', 
      icon: '🚁',
      action: () => executeCommand(() => droneAPI.takeoff(), 'Takeoff'),
      variant: 'success',
      disabled: !droneStatus.armed
    },
    { 
      id: 'land', 
      label: 'LAND', 
      icon: '🛬',
      action: () => executeCommand(() => droneAPI.land(), 'Land'),
      variant: 'primary',
      disabled: !droneStatus.armed
    },
    { 
      id: 'offboard', 
      label: 'OFFBOARD', 
      icon: '🎯',
      action: () => executeCommand(() => droneAPI.setOffboard(), 'Set Offboard'),
      variant: 'info',
      disabled: false  // Always allow offboard to be set
    }
  ];

  const getButtonClass = (variant: string, disabled: boolean) => {
    const baseClass = 'hotbar-btn';
    const variantClass = {
      primary: 'btn-primary',
      secondary: 'btn-secondary', 
      success: 'btn-success',
      warning: 'btn-warning',
      info: 'btn-info'
    }[variant] || 'btn-secondary';
    
    return `${baseClass} ${variantClass} ${disabled ? 'btn-disabled' : ''}`;
  };

  return (
    <div className="flight-controls-hotbar">
      <div className="hotbar-main">
        {/* Critical flight commands - compact military style */}
        <div className="hotbar-group-compact">
          {quickCommands.map((cmd) => (
            <button
              key={cmd.id}
              className={getButtonClass(cmd.variant, cmd.disabled || isLoading)}
              onClick={cmd.action}
              disabled={cmd.disabled || isLoading}
              title={cmd.label}
            >
              <span className="btn-icon">{cmd.icon}</span>
              <span className="btn-text">{cmd.label}</span>
            </button>
          ))}
        </div>

        {/* Position control toggle - compact */}
        <div className="hotbar-divider-compact"></div>
        <button
          className={`hotbar-btn-compact btn-secondary ${showPositionControls ? 'active' : ''}`}
          onClick={() => setShowPositionControls(!showPositionControls)}
          title="Position Controls"
        >
          <span className="btn-icon">📍</span>
          <span className="btn-text">POS</span>
        </button>

        {/* Quick position presets */}
        <div className="hotbar-divider-compact"></div>
        <div className="quick-positions">
          <button
            className="hotbar-btn-compact btn-info"
            onClick={() => executeCommand(() => droneAPI.setPosition(0, 0, -5, 0), 'Home Position')}
            title="Home Position (0,0,-5m)"
          >
            <span className="btn-icon">🏠</span>
          </button>
          <button
            className="hotbar-btn-compact btn-info"
            onClick={() => executeCommand(() => droneAPI.setPosition(0, 0, -10, 0), 'High Altitude')}
            title="High Altitude (0,0,-10m)"
          >
            <span className="btn-icon">⬆️</span>
          </button>
          <button
            className="hotbar-btn-compact btn-info"
            onClick={() => executeCommand(() => droneAPI.setPosition(0, 0, -2, 0), 'Low Altitude')}
            title="Low Altitude (0,0,-2m)"
          >
            <span className="btn-icon">⬇️</span>
          </button>
        </div>

        {/* Advanced/Emergency controls */}
        <div className="hotbar-divider-compact"></div>
        <div className="advanced-controls">
          <button
            className="hotbar-btn-compact btn-danger"
            onClick={() => executeCommand(() => droneAPI.land(), 'Emergency Land')}
            disabled={isLoading}
            title="Emergency Landing"
          >
            <span className="btn-icon">🚨</span>
            <span className="btn-text">EMERG</span>
          </button>
        </div>
      </div>

      {/* Compact position controls (expandable) */}
      {showPositionControls && (
        <div className="position-controls-compact">
          <div className="position-inputs-compact">
            <div className="input-group-compact">
              <label>X</label>
              <input
                type="number"
                value={position.x}
                onChange={(e) => setPosition({...position, x: parseFloat(e.target.value) || 0})}
                step="0.1"
                placeholder="0.0"
              />
            </div>
            <div className="input-group-compact">
              <label>Y</label>
              <input
                type="number"
                value={position.y}
                onChange={(e) => setPosition({...position, y: parseFloat(e.target.value) || 0})}
                step="0.1"
                placeholder="0.0"
              />
            </div>
            <div className="input-group-compact">
              <label>Z</label>
              <input
                type="number"
                value={position.z}
                onChange={(e) => setPosition({...position, z: parseFloat(e.target.value) || 0})}
                step="0.1"
                placeholder="-10"
              />
            </div>
            <div className="input-group-compact">
              <label>YAW</label>
              <input
                type="number"
                value={position.yaw}
                onChange={(e) => setPosition({...position, yaw: parseFloat(e.target.value) || 0})}
                step="0.1"
                placeholder="0.0"
              />
            </div>
          </div>
          <button
            className="hotbar-btn-compact btn-primary"
            onClick={handlePositionSet}
            disabled={isLoading}
            title="Execute Position Command"
          >
            <span className="btn-icon">🎯</span>
            <span className="btn-text">EXECUTE</span>
          </button>
        </div>
      )}

      {/* Compact status message */}
      {message && (
        <div className="hotbar-message-compact">
          {message}
        </div>
      )}
    </div>
  );
};

export default FlightControlsHotbar;