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
      backgroundColor: 'rgba(15, 25, 35, 0.95)',
      color: '#e1e8ed',
      padding: '10px 16px',
      border: '1px solid #4a90a4',
      borderRadius: '2px',
      fontSize: '12px',
      fontFamily: '"Segoe UI", "Roboto", sans-serif',
      fontWeight: '500',
      marginTop: '2px',
      boxShadow: '0 2px 8px rgba(0,0,0,0.15)'
    }}>
      {/* Altitude Slider */}
      <div style={{ marginBottom: '6px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
          <span style={{ color: '#a8b8c8' }}>Click Altitude: <strong style={{ color: '#e1e8ed' }}>{targetAltitude}m</strong></span>
          <span style={{ color: '#a8b8c8' }}>Max: <strong style={{ color: '#e1e8ed' }}>{maxAltitude}m</strong></span>
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
            background: `linear-gradient(to right, #4a90a4 0%, #4a90a4 ${(targetAltitude/maxAltitude)*100}%, #2a3a4a ${(targetAltitude/maxAltitude)*100}%, #2a3a4a 100%)`,
            outline: 'none',
            cursor: 'pointer'
          }}
        />
      </div>
      
      {/* Max Altitude Setting */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
        <span style={{ color: '#a8b8c8' }}>Max Altitude:</span>
        <input
          type="number"
          value={maxAltitude}
          onChange={(e) => {
            const newMax = Math.max(10, parseInt(e.target.value) || 50);
            setMaxAltitude(newMax);
            if (targetAltitude > newMax) setTargetAltitude(newMax);
          }}
          style={{
            width: '60px',
            backgroundColor: 'rgba(10, 20, 30, 0.8)',
            color: '#e1e8ed',
            border: '1px solid #4a90a4',
            borderRadius: '2px',
            fontSize: '12px',
            fontFamily: '"Segoe UI", "Roboto", sans-serif',
            padding: '4px 6px',
            textAlign: 'center'
          }}
          min="10"
          max="200"
        />
        <span style={{ color: '#a8b8c8' }}>meters</span>
      </div>
    </div>
  );
};

export default AltitudeControl;