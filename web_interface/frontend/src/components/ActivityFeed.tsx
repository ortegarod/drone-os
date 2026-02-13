import React from 'react';
import { useBridgeState } from '../hooks/useBridgeState';
import './ActivityFeed.css';

const ActivityFeed: React.FC = () => {
  const { status, connected } = useBridgeState();

  if (!connected || !status) {
    return (
      <div className="activity-feed">
        <div className="activity-header">
          <span className="activity-title">AI Activity</span>
          <span className="activity-status offline">Offline</span>
        </div>
        <div className="activity-empty">Connecting to dispatch bridge...</div>
      </div>
    );
  }

  const entries = [...(status.activity_log || [])].reverse();

  return (
    <div className="activity-feed">
      <div className="activity-header">
        <span className="activity-title">AI Dispatch Activity</span>
        <span className={`activity-status ${status.paused ? 'paused' : 'active'}`}>
          {status.paused ? '⏸️ Paused' : '▶️ Active'}
        </span>
      </div>
      <div className="activity-log">
        {entries.length === 0 ? (
          <div className="activity-empty">No activity yet</div>
        ) : (
          entries.map((entry, idx) => {
            const date = new Date(entry.time * 1000);
            const timeStr = date.toLocaleTimeString('en-US', { 
              hour: '2-digit', 
              minute: '2-digit',
              second: '2-digit'
            });

            return (
              <div key={idx} className="activity-entry">
                <span className="activity-time">{timeStr}</span>
                <span className="activity-message">{entry.message}</span>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};

export default ActivityFeed;
