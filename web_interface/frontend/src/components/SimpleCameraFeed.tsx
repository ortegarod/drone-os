import React, { useRef, useState, useEffect } from 'react';

interface SimpleCameraFeedProps {
  droneAPI: any;
  isConnected: boolean;
}

const SimpleCameraFeed: React.FC<SimpleCameraFeedProps> = ({ droneAPI, isConnected }) => {
  const imgRef = useRef<HTMLImageElement>(null);
  const [status, setStatus] = useState<string>('Connecting...');
  const [streamUrl] = useState<string>('http://<tailscale-ip>:8080/stream?topic=/camera/image_raw&type=mjpeg&quality=75&qos_profile=sensor_data');
  
  // Yaw control state
  const [currentYaw, setCurrentYaw] = useState<number>(0);
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

  // Get current drone state to initialize yaw
  useEffect(() => {
    const getCurrentState = async () => {
      if (!droneAPI.ros) return;
      
      try {
        const state = await droneAPI.getState();
        if (state.success && state.state) {
          setCurrentYaw(state.state.local_yaw || 0);
        }
      } catch (error) {
        console.warn('Failed to get current yaw:', error);
      }
    };
    
    getCurrentState();
  }, [droneAPI]);

  // Yaw control functions
  const adjustYaw = async (deltaYaw: number) => {
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
      
      const newYaw = currentYaw + deltaYaw;
      
      // Send position command with new yaw, keeping current position
      const result = await droneAPI.setPosition(
        state.state.local_x,
        state.state.local_y, 
        state.state.local_z,
        newYaw
      );
      
      if (result.success) {
        setCurrentYaw(newYaw);
        setControlMessage(`Yaw adjusted ${deltaYaw > 0 ? 'right' : 'left'} ${Math.abs(deltaYaw)}°`);
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
    }
  };

  // Add keyboard listeners
  useEffect(() => {
    window.addEventListener('keydown', handleKeyPress);
    return () => window.removeEventListener('keydown', handleKeyPress);
  }, [isConnected, currentYaw, isControlling]);

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <div style={{ 
        padding: '1rem', 
        borderBottom: '1px solid #444',
        backgroundColor: '#2d2d2d'
      }}>
        <h2>📹 Simple Camera Feed</h2>
        <div style={{ fontSize: '0.875rem', color: '#888' }}>
          Status: {status}
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
          gap: '8px'
        }}>
          <span style={{
            fontSize: '12px',
            fontWeight: '600',
            color: '#00ff41',
            fontFamily: 'Segoe UI, system-ui, sans-serif'
          }}>
            YAW CONTROL
          </span>
          <div style={{
            fontSize: '11px',
            color: '#888',
            fontFamily: 'monospace'
          }}>
            {currentYaw.toFixed(1)}°
          </div>
        </div>
        
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: '6px'
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
        Keyboard: Q(-45°) A(-15°) D(+15°) E(+45°) | Arrow keys: ← → | Real-time yaw control
      </div>
    </div>
  );
};

export default SimpleCameraFeed;