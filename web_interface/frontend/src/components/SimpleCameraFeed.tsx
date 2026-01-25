import React, { useRef, useState, useEffect } from 'react';

interface SimpleCameraFeedProps {
  droneAPI: any;
  isConnected: boolean;
  droneStatus: any;
}

interface VideoSettings {
  width: number;
  height: number;
  quality: number;
  label: string;
}

const videoPresets: VideoSettings[] = [
  { width: 160, height: 120, quality: 20, label: '160p Ultra Low' },
  { width: 320, height: 240, quality: 30, label: '240p Low' },
  { width: 640, height: 480, quality: 50, label: '480p Medium' },
  { width: 1280, height: 720, quality: 70, label: '720p High' },
  { width: 1920, height: 1080, quality: 85, label: '1080p Full' }
];

// Server host where backend services run (rosbridge, camera, etc.)
const SERVER_HOST = process.env.REACT_APP_SERVER_HOST || 'localhost';
const CAMERA_PORT = '8080';

const SimpleCameraFeed: React.FC<SimpleCameraFeedProps> = ({ droneAPI, isConnected, droneStatus }) => {
  const imgRef = useRef<HTMLImageElement>(null);
  const [status, setStatus] = useState<string>('Connecting...');
  const [currentPreset, setCurrentPreset] = useState<VideoSettings>(videoPresets[1]); // Default to 240p Low
  const [streamUrl, setStreamUrl] = useState<string>(`http://${SERVER_HOST}:${CAMERA_PORT}/stream?topic=/camera/image_raw&type=mjpeg&width=320&height=240&quality=30&qos_profile=sensor_data`);
  const [showSettings, setShowSettings] = useState<boolean>(false);

  // Update stream URL when preset changes
  const updateStreamUrl = (preset: VideoSettings) => {
    const newUrl = `http://${SERVER_HOST}:${CAMERA_PORT}/stream?topic=/camera/image_raw&type=mjpeg&width=${preset.width}&height=${preset.height}&quality=${preset.quality}&qos_profile=sensor_data`;
    setStreamUrl(newUrl);
    setCurrentPreset(preset);
  };

  // Handle preset selection
  const handlePresetChange = (preset: VideoSettings) => {
    updateStreamUrl(preset);
    setShowSettings(false);
    setStatus('Loading new resolution...');
  };

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
          <div style={{
            fontSize: '10px',
            color: '#666',
            fontFamily: 'monospace'
          }}>
            {currentPreset.label}
          </div>
        </div>
        
        <div style={{ position: 'relative' }}>
          <button
            onClick={() => setShowSettings(!showSettings)}
            style={{
              background: 'none',
              border: '1px solid #444',
              color: '#888',
              padding: '4px 8px',
              fontSize: '10px',
              cursor: 'pointer',
              borderRadius: '2px',
              fontFamily: 'monospace'
            }}
          >
            ⚙️ QUALITY
          </button>
          
          {showSettings && (
            <div style={{
              position: 'absolute',
              top: '100%',
              right: 0,
              background: '#2a2a2a',
              border: '1px solid #444',
              borderRadius: '4px',
              padding: '8px',
              zIndex: 1000,
              minWidth: '150px',
              boxShadow: '0 4px 8px rgba(0,0,0,0.5)'
            }}>
              {videoPresets.map((preset) => (
                <button
                  key={preset.label}
                  onClick={() => handlePresetChange(preset)}
                  style={{
                    display: 'block',
                    width: '100%',
                    background: currentPreset.label === preset.label ? '#444' : 'none',
                    border: 'none',
                    color: '#fff',
                    padding: '6px 8px',
                    fontSize: '10px',
                    cursor: 'pointer',
                    textAlign: 'left',
                    fontFamily: 'monospace',
                    borderRadius: '2px',
                    marginBottom: '2px'
                  }}
                  onMouseEnter={(e) => {
                    if (currentPreset.label !== preset.label) {
                      (e.target as HTMLElement).style.background = '#333';
                    }
                  }}
                  onMouseLeave={(e) => {
                    if (currentPreset.label !== preset.label) {
                      (e.target as HTMLElement).style.background = 'none';
                    }
                  }}
                >
                  {preset.label}
                </button>
              ))}
            </div>
          )}
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