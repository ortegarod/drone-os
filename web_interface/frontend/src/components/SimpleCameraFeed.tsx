import React, { useRef, useState, useEffect } from 'react';
import './SimpleCameraFeed.css';

interface Props {
  droneAPI: any;
  isConnected: boolean;
  droneStatus: any;
  availableDrones?: string[];
  setTargetDrone?: (name: string) => void;
  commandOverlay?: {
    state?: string; message?: string; mode?: string; armed?: boolean;
    target?: { label?: string; x?: number; y?: number; z?: number };
  };
}

interface Preset { width: number; height: number; quality: number; label: string }

const presets: Preset[] = [
  { width: 320, height: 240, quality: 30, label: '240p' },
  { width: 640, height: 480, quality: 50, label: '480p' },
  { width: 800, height: 600, quality: 60, label: '600p' },
  { width: 1280, height: 720, quality: 70, label: '720p' },
];

const HOST = typeof window !== 'undefined' ? window.location.hostname : 'localhost';

const streamUrl = (preset: Preset, drone: string) =>
  `http://${HOST}:8080/stream?topic=${encodeURIComponent(`/${drone}/camera`)}&type=mjpeg&width=${preset.width}&height=${preset.height}&quality=${preset.quality}`;

const SimpleCameraFeed: React.FC<Props> = ({ isConnected, droneStatus, commandOverlay, availableDrones, setTargetDrone }) => {
  const imgRef = useRef<HTMLImageElement>(null);
  const [status, setStatus] = useState('connecting');
  const [preset, setPreset] = useState(presets[1]);
  const [url, setUrl] = useState('');
  const [showQuality, setShowQuality] = useState(false);

  const drone = droneStatus?.drone_name || 'drone1';
  const alt = (-droneStatus?.position?.z || 0).toFixed(1);
  const mode = commandOverlay?.mode || droneStatus?.flight_mode || '—';
  const armed = typeof commandOverlay?.armed === 'boolean' ? commandOverlay.armed : Boolean(droneStatus?.armed);
  const state = commandOverlay?.state || 'idle';

  useEffect(() => {
    setUrl(streamUrl(preset, drone));
    setStatus('loading');
  }, [drone, preset]);

  useEffect(() => {
    if (!imgRef.current) return;
    const img = imgRef.current;
    const onLoad = () => setStatus('live');
    const onErr = () => setStatus('error');
    img.addEventListener('load', onLoad);
    img.addEventListener('error', onErr);
    img.src = url;
    return () => { img.removeEventListener('load', onLoad); img.removeEventListener('error', onErr); img.src = ''; };
  }, [url]);

  const statusColor = status === 'live' ? '#3fb950' : status === 'error' ? '#f85149' : '#f39c12';
  const otherDrones = availableDrones?.filter(d => d !== drone) || [];

  return (
    <div className="cam-root">
      {/* HUD */}
      <div className="cam-hud">
        <span>{drone}</span>
        <span>{mode}</span>
        <span style={{ color: armed ? '#f85149' : undefined }}>{armed ? 'ARMED' : 'SAFE'}</span>
        <span>ALT {alt}m</span>
        <span>{state}</span>
        <span style={{ color: statusColor }}>● {status}</span>
        {!isConnected && <span style={{ color: '#f39c12' }}>ROS ✕</span>}
        {commandOverlay?.message && <span>| {commandOverlay.message}</span>}
        <button className="cam-quality-btn" onClick={() => setShowQuality(!showQuality)}>{preset.label}</button>
        {showQuality && (
          <div className="cam-quality-menu">
            {presets.map(p => (
              <button key={p.label} className={p.label === preset.label ? 'active' : ''} onClick={() => { setPreset(p); setShowQuality(false); }}>{p.label}</button>
            ))}
          </div>
        )}
      </div>

      {/* Main feed */}
      <div className="cam-feed">
        {url && <img key={url} ref={imgRef} alt="Camera" />}
      </div>

      {/* PiP */}
      {otherDrones.length > 0 && (
        <div className="cam-pip-stack">
          {otherDrones.map(d => (
            <div key={d} className="cam-pip" onClick={() => setTargetDrone?.(d)}>
              <span className="cam-pip-label">{d}</span>
              <img key={d} src={streamUrl({ width: 320, height: 240, quality: 30, label: 'pip' }, d)} alt={d} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default SimpleCameraFeed;
