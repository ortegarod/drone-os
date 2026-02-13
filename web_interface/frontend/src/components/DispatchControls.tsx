import React from 'react';
import { BridgeStatus } from '../hooks/useBridgeState';
import './DispatchControls.css';

interface DispatchControlsProps {
  bridgeStatus: BridgeStatus | null;
  bridgeConnected: boolean;
  onToggle: () => void;
  isAuthed: boolean;
  onAuth: () => void;
}

const DispatchControls: React.FC<DispatchControlsProps> = ({
  bridgeStatus,
  bridgeConnected,
  onToggle,
  isAuthed,
  onAuth,
}) => {
  const paused = bridgeStatus?.paused ?? true;

  return (
    <div className="dispatch-controls">
      <div className="dispatch-controls-row">
        <span className={`bridge-indicator ${bridgeConnected ? 'online' : 'offline'}`}>
          {bridgeConnected ? '● BRIDGE' : '○ BRIDGE'}
        </span>

        <button
          className={`dispatch-toggle-btn ${paused ? 'paused' : 'active'}`}
          onClick={onToggle}
          disabled={!bridgeConnected}
          title={paused ? 'Resume autonomous dispatch' : 'Pause autonomous dispatch'}
        >
          {paused ? '▶ RESUME' : '⏸ PAUSE'}
        </button>

        {!isAuthed && (
          <button className="auth-btn" onClick={onAuth} title="Unlock operator controls">
            🔑 UNLOCK
          </button>
        )}

        {bridgeStatus && (
          <span className="dispatch-stats">
            {bridgeStatus.seen_count} processed
          </span>
        )}
      </div>
    </div>
  );
};

export default DispatchControls;
