import React from 'react';

interface AltitudeControlProps {
  targetAltitude: number;
  setTargetAltitude: (altitude: number) => void;
  maxAltitude: number;
  setMaxAltitude: (maxAltitude: number) => void;
}

const AltitudeControl: React.FC<AltitudeControlProps> = ({
  targetAltitude,
  setTargetAltitude,
  maxAltitude,
  setMaxAltitude
}) => {
  return (
    <div style={{
      backgroundColor: 'rgba(0, 0, 0, 0.9)',
      color: '#00ff41',
      padding: '8px 12px',
      border: '1px solid #00ff41',
      borderRadius: '3px',
      fontSize: '11px',
      fontFamily: 'monospace',
      marginTop: '4px'
    }}>
      {/* Altitude Slider */}
      <div style={{ marginBottom: '6px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '2px' }}>
          <span>Click Alt: {targetAltitude}m</span>
          <span>Max: {maxAltitude}m</span>
        </div>
        <input
          type="range"
          min="1"
          max={maxAltitude}
          value={targetAltitude}
          onChange={(e) => setTargetAltitude(parseInt(e.target.value))}
          style={{
            width: '100%',
            appearance: 'none',
            height: '4px',
            borderRadius: '2px',
            background: `linear-gradient(to right, #00ff41 0%, #00ff41 ${(targetAltitude/maxAltitude)*100}%, #333 ${(targetAltitude/maxAltitude)*100}%, #333 100%)`,
            outline: 'none',
            cursor: 'pointer'
          }}
        />
      </div>
      
      {/* Max Altitude Setting */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
        <span>Max Alt:</span>
        <input
          type="number"
          value={maxAltitude}
          onChange={(e) => {
            const newMax = Math.max(10, parseInt(e.target.value) || 50);
            setMaxAltitude(newMax);
            if (targetAltitude > newMax) setTargetAltitude(newMax);
          }}
          style={{
            width: '50px',
            backgroundColor: 'transparent',
            color: '#00ff41',
            border: '1px solid #00ff41',
            borderRadius: '2px',
            fontSize: '11px',
            fontFamily: 'monospace',
            padding: '2px 4px',
            textAlign: 'center'
          }}
          min="10"
          max="200"
        />
        <span>m</span>
      </div>
    </div>
  );
};

export default AltitudeControl;