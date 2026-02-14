import React, { useEffect, useRef } from 'react';
import { useBridgeState } from '../hooks/useBridgeState';
import './ActivityFeed.css';

const ActivityFeed: React.FC = () => {
  const { status, connected } = useBridgeState();
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [status?.activity_log?.length]);

  const formatTime = (ts: number) => {
    const d = new Date(ts * 1000);
    return d.toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
  };

  const msgColor = (msg: string) => {
    if (msg.includes('🚨')) return 'af-alert';
    if (msg.includes('🧠')) return 'af-ai';
    if (msg.includes('🛸')) return 'af-dispatch';
    if (msg.includes('❌')) return 'af-error';
    if (msg.includes('⚠️')) return 'af-warn';
    if (msg.includes('▶️') || msg.includes('⏸️')) return 'af-control';
    return '';
  };

  return (
    <div className="af-root">
      <div className="af-header">
        <span className="af-title">ACTIVITY LOG</span>
        {status?.session_mode && (
          <span className="af-session-mode">
            {status.session_mode === 'isolated' ? '🔀 Isolated Sessions' : '💬 Main Session'}
          </span>
        )}
      </div>
      <div className="af-feed">
        {(!status?.activity_log || status.activity_log.length === 0) && (
          <div className="af-empty">
            {!connected ? 'bridge offline' : 'waiting for activity…'}
          </div>
        )}
        {status?.activity_log?.map((entry, i) => (
          <div key={i} className={`af-entry ${msgColor(entry.message)}`}>
            <span className="af-time">{formatTime(entry.time)}</span>
            <span className="af-msg">{entry.message}</span>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>
    </div>
  );
};

export default ActivityFeed;
