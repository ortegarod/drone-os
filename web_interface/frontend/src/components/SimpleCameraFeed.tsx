import React, { useRef, useState, useEffect } from 'react';

interface SimpleCameraFeedProps {
  droneAPI: any;
  isConnected: boolean;
  droneStatus: any;
  commandOverlay?: {
    state?: string;
    message?: string;
    target?: { label?: string; x?: number; y?: number; z?: number };
    telemetry?: { x?: number; y?: number; z?: number };
    mode?: string;
    armed?: boolean;
  };
}

interface VideoSettings {
  width: number;
  height: number;
  quality: number;
  label: string;
}

const videoPresets: VideoSettings[] = [
  { width: 320, height: 240, quality: 30, label: '240p Low' },
  { width: 640, height: 480, quality: 50, label: '480p Medium' },
  { width: 800, height: 600, quality: 60, label: '600p Good' },
  { width: 1280, height: 720, quality: 70, label: '720p High' },
];

const SERVER_HOST = typeof window !== 'undefined' ? window.location.hostname : 'localhost';
const CAMERA_PORT = '8080';

const SimpleCameraFeed: React.FC<SimpleCameraFeedProps> = ({ isConnected, droneStatus, commandOverlay }) => {
  const imgRef = useRef<HTMLImageElement>(null);
  const [streamStatus, setStreamStatus] = useState<string>('connecting');
  const [currentPreset, setCurrentPreset] = useState<VideoSettings>(videoPresets[1]);
  const [streamUrl, setStreamUrl] = useState<string>('');
  const [showSettings, setShowSettings] = useState<boolean>(false);

  const selectedDrone = droneStatus?.drone_name || 'drone1';

  const buildStreamUrl = (preset: VideoSettings, droneName: string) => {
    const topic = `/${droneName}/camera`;
    return `http://${SERVER_HOST}:${CAMERA_PORT}/stream?topic=${encodeURIComponent(topic)}&type=mjpeg&width=${preset.width}&height=${preset.height}&quality=${preset.quality}`;
  };

  // Update stream URL when drone or preset changes
  useEffect(() => {
    const newUrl = buildStreamUrl(currentPreset, selectedDrone);
    console.log(`[SimpleCameraFeed] Drone changed: ${selectedDrone}, URL: ${newUrl}`);
    setStreamUrl(newUrl);
    setStreamStatus('loading');
  }, [selectedDrone, currentPreset]);

  const updateStreamUrl = (preset: VideoSettings) => {
    setCurrentPreset(preset);
  };

  const handlePresetChange = (preset: VideoSettings) => {
    updateStreamUrl(preset);
    setShowSettings(false);
    setStreamStatus('loading');
  };

  useEffect(() => {
    if (!imgRef.current) return;

    const img = imgRef.current;

    const handleLoad = () => setStreamStatus('live');
    const handleError = () => setStreamStatus('error');

    img.addEventListener('load', handleLoad);
    img.addEventListener('error', handleError);
    img.src = streamUrl;
    setStreamStatus('loading');

    return () => {
      img.removeEventListener('load', handleLoad);
      img.removeEventListener('error', handleError);
      // Abort the HTTP stream by clearing src
      img.src = '';
    };
  }, [streamUrl]);

  const altitude = (-droneStatus?.position?.z || 0).toFixed(1);
  const x = (droneStatus?.position?.x || 0).toFixed(2);
  const y = (droneStatus?.position?.y || 0).toFixed(2);
  const mode = commandOverlay?.mode || droneStatus?.flight_mode || 'unknown';
  const armed = typeof commandOverlay?.armed === 'boolean' ? commandOverlay.armed : Boolean(droneStatus?.armed);
  const state = commandOverlay?.state || 'idle';

  const targetLabel = commandOverlay?.target?.label ||
    (commandOverlay?.target ? `x=${commandOverlay.target.x ?? '-'}, y=${commandOverlay.target.y ?? '-'}, z=${commandOverlay.target.z ?? '-'}` : 'none');

  const streamColor =
    streamStatus === 'live' ? '#3fb950' : streamStatus === 'error' ? '#f85149' : '#f39c12';

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', position: 'relative', backgroundColor: '#1a1a1a' }}>
      <div
        style={{
          position: 'absolute',
          top: 8,
          left: 8,
          right: 8,
          zIndex: 100,
          pointerEvents: 'none',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 8,
          background: 'rgba(10, 14, 18, 0.56)',
          border: '1px solid rgba(85, 95, 110, 0.65)',
          borderRadius: 6,
          padding: '6px 8px',
          backdropFilter: 'blur(4px)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 11, color: '#8b949e', fontFamily: 'monospace' }}>drone {droneStatus?.drone_name || 'none'}</span>
          <span style={{ fontSize: 11, color: '#c9d1d9', fontFamily: 'monospace' }}>mode {mode}</span>
          <span style={{ fontSize: 11, color: armed ? '#f85149' : '#8b949e', fontFamily: 'monospace' }}>armed {armed ? 'yes' : 'no'}</span>
          <span style={{ fontSize: 11, color: '#c9d1d9', fontFamily: 'monospace' }}>alt {altitude}m</span>
          <span style={{ fontSize: 11, color: '#8b949e', fontFamily: 'monospace' }}>x {x} y {y}</span>
          <span style={{ fontSize: 11, color: '#8b949e', fontFamily: 'monospace' }}>target {targetLabel}</span>
          <span style={{ fontSize: 11, color: '#c9d1d9', fontFamily: 'monospace' }}>state {state}</span>
          <span style={{ fontSize: 11, color: streamColor, fontFamily: 'monospace' }}>stream {streamStatus}</span>
          {!isConnected && (
            <span style={{ fontSize: 11, color: '#f39c12', fontFamily: 'monospace' }}>ros offline</span>
          )}
          {commandOverlay?.message && (
            <span style={{ fontSize: 11, color: '#c9d1d9', fontFamily: 'monospace' }}>| {commandOverlay.message}</span>
          )}
        </div>

        <div style={{ position: 'relative', pointerEvents: 'auto' }}>
          <button
            onClick={() => setShowSettings(!showSettings)}
            style={{
              background: 'rgba(18, 22, 27, 0.9)',
              border: '1px solid #3f4652',
              color: '#c9d1d9',
              padding: '4px 8px',
              fontSize: '10px',
              cursor: 'pointer',
              borderRadius: '4px',
              fontFamily: 'monospace',
            }}
          >
            quality {currentPreset.label}
          </button>

          {showSettings && (
            <div
              style={{
                position: 'absolute',
                top: '100%',
                right: 0,
                marginTop: 4,
                background: 'rgba(22, 28, 35, 0.96)',
                border: '1px solid #3f4652',
                borderRadius: 4,
                padding: 6,
                zIndex: 1000,
                minWidth: 150,
              }}
            >
              {videoPresets.map((preset) => (
                <button
                  key={preset.label}
                  onClick={() => handlePresetChange(preset)}
                  style={{
                    display: 'block',
                    width: '100%',
                    background: currentPreset.label === preset.label ? '#2f3946' : 'transparent',
                    border: 'none',
                    color: '#fff',
                    padding: '6px 8px',
                    fontSize: '10px',
                    cursor: 'pointer',
                    textAlign: 'left',
                    fontFamily: 'monospace',
                    borderRadius: 2,
                    marginBottom: 2,
                  }}
                >
                  {preset.label}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        {streamUrl && (
          <img
            key={streamUrl}
            ref={imgRef}
            style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }}
            alt="Camera feed"
          />
        )}
      </div>
    </div>
  );
};

export default SimpleCameraFeed;
