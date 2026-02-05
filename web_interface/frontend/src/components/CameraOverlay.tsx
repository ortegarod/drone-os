import React, { useRef, useState, useEffect } from 'react';

// Use the same host the browser used to load the page (works from any machine)
const SERVER_HOST = typeof window !== 'undefined' ? window.location.hostname : 'localhost';

type ViewMode = 'pip' | 'minimized' | 'maximized';

const CameraOverlay: React.FC = () => {
  const imgRef = useRef<HTMLImageElement>(null);
  const [mode, setMode] = useState<ViewMode>('pip');
  const [hasSignal, setHasSignal] = useState(false);

  const quality = mode === 'maximized' ? 60 : 30;
  const resolution = mode === 'maximized' ? 'width=800&height=600' : 'width=320&height=240';
  const streamUrl = `http://${SERVER_HOST}:8080/stream?topic=/camera&type=mjpeg&${resolution}&quality=${quality}`;

  useEffect(() => {
    const img = imgRef.current;
    if (!img) return;
    const onLoad = () => setHasSignal(true);
    const onError = () => setHasSignal(false);
    img.addEventListener('load', onLoad);
    img.addEventListener('error', onError);
    return () => {
      img.removeEventListener('load', onLoad);
      img.removeEventListener('error', onError);
    };
  }, [mode]);

  if (mode === 'minimized') {
    return (
      <button
        onClick={() => setMode('pip')}
        style={{
          position: 'absolute',
          bottom: 12,
          left: 12,
          zIndex: 10,
          background: '#222',
          border: '1px solid #444',
          borderRadius: 4,
          color: '#888',
          fontSize: 11,
          fontFamily: 'monospace',
          padding: '4px 10px',
          cursor: 'pointer',
        }}
      >
        CAM
      </button>
    );
  }

  const isMax = mode === 'maximized';

  return (
    <div style={{
      position: 'absolute',
      bottom: isMax ? 0 : 12,
      left: isMax ? 0 : 12,
      right: isMax ? 0 : undefined,
      top: isMax ? 0 : undefined,
      width: isMax ? undefined : 240,
      height: isMax ? undefined : 180,
      border: isMax ? 'none' : '1px solid #444',
      borderRadius: isMax ? 0 : 4,
      overflow: 'hidden',
      boxShadow: isMax ? 'none' : '0 4px 12px rgba(0,0,0,0.6)',
      zIndex: 10,
      background: '#111',
    }}>
      {/* Header */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '3px 8px',
        background: isMax ? 'rgba(0,0,0,0.6)' : '#1a1a1a',
        borderBottom: isMax ? 'none' : '1px solid #333',
        fontSize: 10,
        fontFamily: 'monospace',
        position: isMax ? 'absolute' : undefined,
        top: 0,
        left: 0,
        right: 0,
        zIndex: 11,
      }}>
        <span style={{ color: '#888' }}>CAM</span>
        <span style={{ color: hasSignal ? '#00ff88' : '#ff4444' }}>
          {hasSignal ? 'LIVE' : 'NO SIGNAL'}
        </span>
        <span style={{ flex: 1 }} />
        {/* Maximize / Restore */}
        <button
          onClick={() => setMode(isMax ? 'pip' : 'maximized')}
          style={{
            background: 'none', border: 'none', color: '#888',
            cursor: 'pointer', fontSize: 11, padding: '0 2px', lineHeight: 1,
            fontFamily: 'monospace',
          }}
          title={isMax ? 'Restore' : 'Maximize'}
        >
          {isMax ? '⊟' : '⊞'}
        </button>
        {/* Minimize */}
        <button
          onClick={() => setMode('minimized')}
          style={{
            background: 'none', border: 'none', color: '#666',
            cursor: 'pointer', fontSize: 12, padding: '0 2px', lineHeight: 1,
          }}
        >
          _
        </button>
      </div>
      {/* Stream */}
      <img
        ref={imgRef}
        src={streamUrl}
        alt="Camera"
        style={{
          width: '100%',
          height: '100%',
          objectFit: isMax ? 'contain' : 'cover',
          display: 'block',
        }}
      />
    </div>
  );
};

export default CameraOverlay;
