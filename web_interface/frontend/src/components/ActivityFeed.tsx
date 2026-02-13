import React, { useEffect, useRef } from 'react';
import { useBridgeState } from '../hooks/useBridgeState';

const ActivityFeed: React.FC = () => {
  const { status, connected, toggle } = useBridgeState();
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [status?.activity_log?.length]);

  const formatTime = (ts: number) => {
    const d = new Date(ts * 1000);
    return d.toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
  };

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', background: '#0d1117', color: '#c9d1d9' }}>
      {/* Header */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '8px 12px', borderBottom: '1px solid #21262d', background: '#161b22'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 14, fontWeight: 600 }}>🛸 AI Dispatch Activity</span>
          <span style={{
            fontSize: 11, padding: '2px 6px', borderRadius: 4,
            background: connected ? '#1b4332' : '#4a1919',
            color: connected ? '#4ade80' : '#f87171'
          }}>
            {connected ? 'LIVE' : 'OFFLINE'}
          </span>
        </div>
        <button
          onClick={() => { console.log('Toggle clicked'); toggle(); }}
          style={{
            fontSize: 11, padding: '4px 12px', borderRadius: 4, border: 'none', cursor: 'pointer',
            background: status?.paused ? '#238636' : '#da3633',
            color: '#fff', fontWeight: 600
          }}
        >
          {status?.paused ? '▶ RESUME' : '⏸ PAUSE'}
        </button>
      </div>

      {/* Feed */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '8px 12px', fontSize: 13, lineHeight: 1.6 }}>
        {(!status?.activity_log || status.activity_log.length === 0) && (
          <div style={{ color: '#484f58', fontStyle: 'italic', padding: '20px 0', textAlign: 'center' }}>
            {status?.paused ? 'Bridge paused — click RESUME to start dispatching' : 'Waiting for incidents...'}
          </div>
        )}
        {status?.activity_log?.map((entry, i) => {
          const msg = entry.message;
          let color = '#8b949e';
          let weight: 400 | 600 = 400;
          if (msg.includes('🚨')) { color = '#f0883e'; weight = 600; }
          else if (msg.includes('🧠')) { color = '#58a6ff'; }
          else if (msg.includes('🛸')) { color = '#4ade80'; weight = 600; }
          else if (msg.includes('❌')) { color = '#f87171'; }
          else if (msg.includes('⚠️')) { color = '#d29922'; }
          else if (msg.includes('▶️') || msg.includes('⏸️')) { color = '#bc8cff'; }

          return (
            <div key={i} style={{ marginBottom: 6, display: 'flex', gap: 8 }}>
              <span style={{ color: '#484f58', fontSize: 11, flexShrink: 0, fontFamily: 'monospace', marginTop: 2 }}>
                {formatTime(entry.time)}
              </span>
              <span style={{ color, fontWeight: weight, wordBreak: 'break-word' }}>{msg}</span>
            </div>
          );
        })}
        <div ref={bottomRef} />
      </div>
    </div>
  );
};

export default ActivityFeed;
