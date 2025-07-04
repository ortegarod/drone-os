import React, { useRef, useState, useEffect } from 'react';

interface SimpleCameraFeedProps {
  droneAPI: any;
  isConnected: boolean;
  droneStatus: any;
  unitSystem: any;
}

const SimpleCameraFeed: React.FC<SimpleCameraFeedProps> = ({ droneAPI, isConnected, droneStatus, unitSystem }) => {
  const imgRef = useRef<HTMLImageElement>(null);
  const [status, setStatus] = useState<string>('Connecting...');
  const [streamUrl] = useState<string>('http://<tailscale-ip>:8080/stream?topic=/camera/image_raw&type=mjpeg&quality=75&qos_profile=sensor_data');
  
  // Control state
  const [currentYaw, setCurrentYaw] = useState<number>(0);
  const [currentAltitude, setCurrentAltitude] = useState<number>(0);
  const [isControlling, setIsControlling] = useState<boolean>(false);
  const [controlMessage, setControlMessage] = useState<string>('');

  useEffect(() => {
    if (!imgRef.current) return;

    const img = imgRef.current;
    
    const handleLoad = () => {
      setStatus('Live • Native video stream');
    };

    const handleError = () => {
      setStatus('Stream error - check camera service');
    };

    img.addEventListener('load', handleLoad);
    img.addEventListener('error', handleError);
    
    // Set the stream URL
    img.src = streamUrl;
    setStatus('Loading video stream...');

    return () => {
      img.removeEventListener('load', handleLoad);
      img.removeEventListener('error', handleError);
    };
  }, [streamUrl]);

  // Get current drone state to initialize yaw and altitude
  useEffect(() => {
    const getCurrentState = async () => {
      if (!droneAPI.ros) return;
      
      try {
        const state = await droneAPI.getState();
        if (state.success && state.state) {
          setCurrentYaw(state.state.local_yaw || 0);
          setCurrentAltitude(-state.state.local_z || 0); // Convert NED to altitude
        }
      } catch (error) {
        console.warn('Failed to get current state:', error);
      }
    };
    
    getCurrentState();
  }, [droneAPI]);

  // Yaw control functions
  const adjustYaw = async (deltaYawDegrees: number) => {
    if (!droneAPI.ros || isControlling) return;
    
    setIsControlling(true);
    setControlMessage('Adjusting yaw...');
    
    try {
      // Get current position
      const state = await droneAPI.getState();
      if (!state.success || !state.state) {
        setControlMessage('Failed to get current position');
        return;
      }
      
      // Convert degrees to radians for the API call
      const deltaYawRadians = deltaYawDegrees * (Math.PI / 180);
      const newYaw = currentYaw + deltaYawRadians;
      
      // Send position command with new yaw, keeping current position
      const result = await droneAPI.setPosition(
        state.state.local_x,
        state.state.local_y, 
        state.state.local_z,
        newYaw
      );
      
      if (result.success) {
        setCurrentYaw(newYaw);
        setControlMessage(`Yaw adjusted ${deltaYawDegrees > 0 ? 'right' : 'left'} ${Math.abs(deltaYawDegrees)}°`);
      } else {
        setControlMessage(`Yaw control failed: ${result.message}`);
      }
    } catch (error) {
      setControlMessage(`Yaw control error: ${error instanceof Error ? error.message : 'Unknown error'}`);
    } finally {
      setIsControlling(false);
      // Clear message after 2 seconds
      setTimeout(() => setControlMessage(''), 2000);
    }
  };

  // Altitude control functions
  const adjustAltitude = async (deltaAltitudeMeters: number) => {
    if (!droneAPI.ros || isControlling) return;
    
    setIsControlling(true);
    setControlMessage('Adjusting altitude...');
    
    try {
      // Get current position
      const state = await droneAPI.getState();
      if (!state.success || !state.state) {
        setControlMessage('Failed to get current position');
        return;
      }
      
      // Calculate new altitude (convert to NED: negative Z = up)
      const newAltitudeNED = state.state.local_z - deltaAltitudeMeters;
      
      // Send position command with new altitude, keeping current position and yaw
      const result = await droneAPI.setPosition(
        state.state.local_x,
        state.state.local_y, 
        newAltitudeNED,
        state.state.local_yaw
      );
      
      if (result.success) {
        setCurrentAltitude(currentAltitude + deltaAltitudeMeters);
        setControlMessage(`Altitude adjusted ${deltaAltitudeMeters > 0 ? 'up' : 'down'} ${Math.abs(deltaAltitudeMeters)}m`);
      } else {
        setControlMessage(`Altitude control failed: ${result.message}`);
      }
    } catch (error) {
      setControlMessage(`Altitude control error: ${error instanceof Error ? error.message : 'Unknown error'}`);
    } finally {
      setIsControlling(false);
      // Clear message after 2 seconds
      setTimeout(() => setControlMessage(''), 2000);
    }
  };

  const handleKeyPress = (event: KeyboardEvent) => {
    if (!isConnected) return;
    
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

  // Add keyboard listeners
  useEffect(() => {
    window.addEventListener('keydown', handleKeyPress);
    return () => window.removeEventListener('keydown', handleKeyPress);
  }, [isConnected, currentYaw, currentAltitude, isControlling]);

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      {/* Status bar similar to hotbar */}
      <div style={{
        backgroundColor: '#1a1a1a',
        borderBottom: '1px solid #444',
        padding: '8px 16px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: '12px'
      }}>
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: '12px'
        }}>
          <div style={{
            fontSize: '12px',
            fontWeight: '600',
            color: '#888',
            fontFamily: 'Segoe UI, system-ui, sans-serif'
          }}>
            📹 CAMERA
          </div>
          <div style={{
            fontSize: '11px',
            color: status.includes('Live') ? '#00ff41' : status.includes('error') ? '#e74c3c' : '#f39c12',
            fontFamily: 'monospace'
          }}>
            {status}
          </div>
        </div>
        
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: '12px'
        }}>
          <span style={{
            fontSize: '11px',
            fontWeight: '600',
            color: droneStatus.armed ? '#e74c3c' : '#00ff41',
            fontFamily: 'Segoe UI, system-ui, sans-serif'
          }}>
            {droneStatus.armed ? '🔴 ARMED' : '🟢 DISARMED'}
          </span>
          <span style={{
            fontSize: '11px',
            color: '#888',
            fontFamily: 'Segoe UI, system-ui, sans-serif'
          }}>
            Mode: {droneStatus.flight_mode}
          </span>
          <span style={{
            fontSize: '11px',
            color: '#888',
            fontFamily: 'Segoe UI, system-ui, sans-serif'
          }}>
            Alt: {((unitSystem === 'imperial' ? -droneStatus.position.z * 3.28084 : -droneStatus.position.z) || 0).toFixed(1)}{unitSystem === 'imperial' ? 'ft' : 'm'}
          </span>
        </div>
      </div>
      
      <div style={{ 
        flex: 1, 
        display: 'flex', 
        alignItems: 'center', 
        justifyContent: 'center',
        backgroundColor: '#1a1a1a'
      }}>
        <img
          ref={imgRef}
          style={{
            maxWidth: '100%',
            maxHeight: '100%',
            objectFit: 'contain'
          }}
          alt="Camera feed"
        />
      </div>
      
      {/* Drone Controls Hotbar */}
      <div style={{
        backgroundColor: '#1a1a1a',
        borderTop: '1px solid #444',
        padding: '8px 16px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: '12px'
      }}>
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: '12px'
        }}>
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: '6px'
          }}>
            <span style={{
              fontSize: '12px',
              fontWeight: '600',
              color: '#00ff41',
              fontFamily: 'Segoe UI, system-ui, sans-serif'
            }}>
              YAW
            </span>
            <div style={{
              fontSize: '11px',
              color: '#888',
              fontFamily: 'monospace'
            }}>
              {(currentYaw * 180 / Math.PI).toFixed(1)}°
            </div>
          </div>
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: '6px'
          }}>
            <span style={{
              fontSize: '12px',
              fontWeight: '600',
              color: '#1e90ff',
              fontFamily: 'Segoe UI, system-ui, sans-serif'
            }}>
              ALT
            </span>
            <div style={{
              fontSize: '11px',
              color: '#888',
              fontFamily: 'monospace'
            }}>
              {currentAltitude.toFixed(1)}m
            </div>
          </div>
        </div>
        
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: '8px'
        }}>
          {/* Altitude Controls */}
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: '4px'
          }}>
            {/* Large altitude up */}
            <button
              onClick={() => adjustAltitude(5)}
              disabled={isControlling || !isConnected}
              style={{
                background: 'linear-gradient(135deg, #27ae60, #229954)',
                border: '1px solid #2c3e50',
                borderRadius: '4px',
                color: '#ffffff',
                padding: '6px 8px',
                fontSize: '11px',
                fontWeight: '600',
                cursor: isControlling || !isConnected ? 'not-allowed' : 'pointer',
                opacity: isControlling || !isConnected ? 0.5 : 1,
                minWidth: '32px',
                fontFamily: 'Segoe UI, system-ui, sans-serif'
              }}
              title="Climb 5m (R key)"
            >
              ↑↑
            </button>
            
            {/* Small altitude up */}
            <button
              onClick={() => adjustAltitude(2)}
              disabled={isControlling || !isConnected}
              style={{
                background: 'linear-gradient(135deg, #3498db, #2980b9)',
                border: '1px solid #2c3e50',
                borderRadius: '4px',
                color: '#ffffff',
                padding: '6px 8px',
                fontSize: '11px',
                fontWeight: '600',
                cursor: isControlling || !isConnected ? 'not-allowed' : 'pointer',
                opacity: isControlling || !isConnected ? 0.5 : 1,
                minWidth: '32px',
                fontFamily: 'Segoe UI, system-ui, sans-serif'
              }}
              title="Climb 2m (W key or ↑ arrow)"
            >
              ↑
            </button>
            
            {/* Small altitude down */}
            <button
              onClick={() => adjustAltitude(-2)}
              disabled={isControlling || !isConnected}
              style={{
                background: 'linear-gradient(135deg, #3498db, #2980b9)',
                border: '1px solid #2c3e50',
                borderRadius: '4px',
                color: '#ffffff',
                padding: '6px 8px',
                fontSize: '11px',
                fontWeight: '600',
                cursor: isControlling || !isConnected ? 'not-allowed' : 'pointer',
                opacity: isControlling || !isConnected ? 0.5 : 1,
                minWidth: '32px',
                fontFamily: 'Segoe UI, system-ui, sans-serif'
              }}
              title="Descend 2m (S key or ↓ arrow)"
            >
              ↓
            </button>
            
            {/* Large altitude down */}
            <button
              onClick={() => adjustAltitude(-5)}
              disabled={isControlling || !isConnected}
              style={{
                background: 'linear-gradient(135deg, #e67e22, #d35400)',
                border: '1px solid #2c3e50',
                borderRadius: '4px',
                color: '#ffffff',
                padding: '6px 8px',
                fontSize: '11px',
                fontWeight: '600',
                cursor: isControlling || !isConnected ? 'not-allowed' : 'pointer',
                opacity: isControlling || !isConnected ? 0.5 : 1,
                minWidth: '32px',
                fontFamily: 'Segoe UI, system-ui, sans-serif'
              }}
              title="Descend 5m (F key)"
            >
              ↓↓
            </button>
          </div>
          
          {/* Separator */}
          <div style={{
            width: '1px',
            height: '24px',
            background: '#444',
            margin: '0 4px'
          }} />
          
          {/* Yaw Controls */}
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: '4px'
          }}>
            {/* Large left rotation */}
            <button
            onClick={() => adjustYaw(-45)}
            disabled={isControlling || !isConnected}
            style={{
              background: 'linear-gradient(135deg, #e74c3c, #c0392b)',
              border: '1px solid #2c3e50',
              borderRadius: '4px',
              color: '#ffffff',
              padding: '6px 8px',
              fontSize: '11px',
              fontWeight: '600',
              cursor: isControlling || !isConnected ? 'not-allowed' : 'pointer',
              opacity: isControlling || !isConnected ? 0.5 : 1,
              minWidth: '32px',
              fontFamily: 'Segoe UI, system-ui, sans-serif'
            }}
            title="Rotate left 45° (Q key)"
          >
            ⤺
          </button>
          
          {/* Small left rotation */}
          <button
            onClick={() => adjustYaw(-15)}
            disabled={isControlling || !isConnected}
            style={{
              background: 'linear-gradient(135deg, #f39c12, #e67e22)',
              border: '1px solid #2c3e50',
              borderRadius: '4px',
              color: '#ffffff',
              padding: '6px 8px',
              fontSize: '11px',
              fontWeight: '600',
              cursor: isControlling || !isConnected ? 'not-allowed' : 'pointer',
              opacity: isControlling || !isConnected ? 0.5 : 1,
              minWidth: '32px',
              fontFamily: 'Segoe UI, system-ui, sans-serif'
            }}
            title="Rotate left 15° (A key or ← arrow)"
          >
            ↶
          </button>
          
          {/* Small right rotation */}
          <button
            onClick={() => adjustYaw(15)}
            disabled={isControlling || !isConnected}
            style={{
              background: 'linear-gradient(135deg, #f39c12, #e67e22)',
              border: '1px solid #2c3e50',
              borderRadius: '4px',
              color: '#ffffff',
              padding: '6px 8px',
              fontSize: '11px',
              fontWeight: '600',
              cursor: isControlling || !isConnected ? 'not-allowed' : 'pointer',
              opacity: isControlling || !isConnected ? 0.5 : 1,
              minWidth: '32px',
              fontFamily: 'Segoe UI, system-ui, sans-serif'
            }}
            title="Rotate right 15° (D key or → arrow)"
          >
            ↷
          </button>
          
          {/* Large right rotation */}
          <button
            onClick={() => adjustYaw(45)}
            disabled={isControlling || !isConnected}
            style={{
              background: 'linear-gradient(135deg, #e74c3c, #c0392b)',
              border: '1px solid #2c3e50',
              borderRadius: '4px',
              color: '#ffffff',
              padding: '6px 8px',
              fontSize: '11px',
              fontWeight: '600',
              cursor: isControlling || !isConnected ? 'not-allowed' : 'pointer',
              opacity: isControlling || !isConnected ? 0.5 : 1,
              minWidth: '32px',
              fontFamily: 'Segoe UI, system-ui, sans-serif'
            }}
            title="Rotate right 45° (E key)"
          >
            ⤻
          </button>
          </div>
        </div>
        
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: '8px'
        }}>
          {/* Status indicator */}
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: '4px'
          }}>
            <div style={{
              width: '6px',
              height: '6px',
              borderRadius: '50%',
              backgroundColor: isConnected ? '#00ff41' : '#e74c3c',
              boxShadow: isConnected ? '0 0 4px #00ff41' : '0 0 4px #e74c3c'
            }} />
            <span style={{
              fontSize: '10px',
              color: isConnected ? '#00ff41' : '#e74c3c',
              fontWeight: '500',
              fontFamily: 'Segoe UI, system-ui, sans-serif'
            }}>
              {isConnected ? 'READY' : 'OFFLINE'}
            </span>
          </div>
          
          {/* Control message */}
          {controlMessage && (
            <div style={{
              fontSize: '10px',
              color: controlMessage.includes('failed') || controlMessage.includes('error') ? '#e74c3c' : '#00ff41',
              fontWeight: '500',
              fontFamily: 'Segoe UI, system-ui, sans-serif',
              maxWidth: '120px',
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis'
            }}>
              {controlMessage}
            </div>
          )}
        </div>
      </div>
      
      {/* Keyboard shortcuts help */}
      <div style={{
        backgroundColor: '#0f0f0f',
        borderTop: '1px solid #333',
        padding: '4px 16px',
        fontSize: '9px',
        color: '#666',
        fontFamily: 'Segoe UI, system-ui, sans-serif',
        textAlign: 'center'
      }}>
        Keyboard: Q(-45°) A(-15°) D(+15°) E(+45°) | W/R(+2m/+5m) S/F(-2m/-5m) | Arrow keys: ← → ↑ ↓ | Real-time control
      </div>
    </div>
  );
};

export default SimpleCameraFeed;