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
      
    </div>
  );
};

export default SimpleCameraFeed;