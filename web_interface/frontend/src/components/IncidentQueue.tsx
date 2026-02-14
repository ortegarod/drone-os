import React, { useState, useEffect, useCallback } from 'react';
import { Incident } from '../hooks/useDispatchState';
import './IncidentQueue.css';

interface IncidentQueueProps {
  incidents: Incident[];
  connected: boolean;
}

const PRI: Record<number, { label: string; color: string }> = {
  1: { label: 'P1', color: '#f85149' },
  2: { label: 'P2', color: '#d29922' },
  3: { label: 'P3', color: '#3fb950' },
};

const STATUS: Record<string, { label: string; color: string }> = {
  new:          { label: 'NEW', color: '#58a6ff' },
  'ai-pending': { label: 'PENDING', color: '#bc8cff' },
  dispatched:   { label: 'EN ROUTE', color: '#d29922' },
  on_scene:     { label: 'ON SITE', color: '#3fb950' },
  returning:    { label: 'RETURNING', color: '#d29922' },
  resolved:     { label: 'RESOLVED', color: '#484f58' },
};

function fmt(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function elapsed(from: string): string {
  const s = Math.floor((Date.now() - new Date(from).getTime()) / 1000);
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
}

const IncidentQueue: React.FC<IncidentQueueProps> = ({ incidents, connected }) => {
  const [selected, setSelected] = useState<string | null>(null);
  const [paused, setPaused] = useState(true);
  const [bridgePaused, setBridgePaused] = useState(true);
  const [mode, setMode] = useState<'auto' | 'manual'>('manual');
  const active = incidents.filter(i => i.status !== 'resolved').length;

  // Poll dispatch status
  useEffect(() => {
    const poll = async () => {
      try {
        const res = await fetch('/api/dispatch/status');
        if (res.ok) {
          const data = await res.json();
          setPaused(data.paused);
          if (data.mode) setMode(data.mode);
        }
      } catch { /* ignore */ }
    };
    poll();
    const interval = setInterval(poll, 3000);
    return () => clearInterval(interval);
  }, []);

  // Poll bridge status
  useEffect(() => {
    const poll = async () => {
      try {
        const res = await fetch('/api/bridge/status');
        if (res.ok) {
          const data = await res.json();
          setBridgePaused(data.paused);
        }
      } catch { /* ignore */ }
    };
    poll();
    const interval = setInterval(poll, 3000);
    return () => clearInterval(interval);
  }, []);

  const toggleSystem = useCallback(async () => {
    const newState = !paused;
    try {
      // Toggle both dispatch and bridge together
      if (newState) {
        await fetch('/api/dispatch/pause', { method: 'POST' });
        await fetch('/api/bridge/toggle', { method: 'POST' });
      } else {
        await fetch('/api/dispatch/resume', { method: 'POST' });
        await fetch('/api/bridge/toggle', { method: 'POST' });
      }
      setPaused(newState);
      setBridgePaused(newState);
    } catch { /* ignore */ }
  }, [paused]);

  const clearAll = useCallback(async () => {
    if (!window.confirm('Clear all incidents? This cannot be undone.')) return;
    try {
      await fetch('/api/dispatch/clear', { method: 'POST' });
      setSelected(null);
    } catch { /* ignore */ }
  }, []);

  const toggleMode = useCallback(async () => {
    const newMode = mode === 'auto' ? 'manual' : 'auto';
    try {
      const res = await fetch('/api/dispatch/mode', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: newMode }),
      });
      if (res.ok) setMode(newMode);
    } catch { /* ignore */ }
  }, [mode]);

  const triggerIncident = useCallback(async () => {
    try {
      await fetch('/api/dispatch/trigger', { method: 'POST' });
    } catch { /* ignore */ }
  }, []);

  const resolveIncident = useCallback(async (incidentId: string) => {
    try {
      const res = await fetch(`/api/dispatch/resolve/${incidentId}`, { method: 'POST' });
      if (!res.ok) {
        const data = await res.json();
        alert(`Failed to resolve: ${data.error || 'unknown error'}`);
      }
    } catch (err) {
      alert(`Failed to resolve incident: ${err}`);
    }
  }, []);

  const systemStatus = paused ? '⏸ PAUSED' : '▶ ACTIVE';
  const systemColor = paused ? '#8b949e' : '#3fb950';

  return (
    <div className="iq-root">
      <div className="iq-header">
        <span>DISPATCH</span>
        <span className={`iq-status ${connected ? 'on' : 'off'}`}>{connected ? '●' : '○'}</span>
      </div>
      <div className="iq-controls">
        <button
          className={`iq-btn ${paused ? 'paused' : 'active'}`}
          onClick={toggleSystem}
          disabled={!connected}
          title={paused ? 'Resume incident generation & AI dispatch' : 'Pause incident generation & AI dispatch'}
        >
          {paused ? '▶ RESUME' : '⏸ PAUSE'}
        </button>
        <button
          className="iq-btn clear"
          onClick={clearAll}
          disabled={!connected || active === 0}
          title="Clear all incidents"
        >
          🗑️ CLEAR
        </button>
        <span className="iq-system-status" style={{ color: systemColor }}>
          {systemStatus}
        </span>
      </div>
      <div className="iq-controls iq-controls-secondary">
        <button
          className={`iq-btn mode ${mode === 'auto' ? 'auto' : 'manual'}`}
          onClick={toggleMode}
          disabled={!connected}
          title={mode === 'auto' ? 'Switch to manual mode (trigger incidents manually)' : 'Switch to auto mode (incidents generated on timer)'}
        >
          {mode === 'auto' ? '⚙ AUTO' : '🎯 MANUAL'}
        </button>
        <button
          className="iq-btn trigger"
          onClick={triggerIncident}
          disabled={!connected || paused}
          title="Trigger a new random incident"
        >
          🚨 NEW INCIDENT
        </button>
      </div>
      <div className="iq-stats">
        <span>{active} active</span>
        <span>•</span>
        <span>{incidents.length} total</span>
      </div>
      <div className="iq-list">
        {incidents.length === 0 && (
          <div className="iq-empty">{connected ? 'no incidents' : 'dispatch offline'}</div>
        )}
        {incidents.map((inc) => {
          const expanded = selected === inc.id;
          const pri = PRI[inc.priority] || { label: '?', color: '#8b949e' };
          const realStatus = inc.assigned_to === 'ai-pending' ? 'ai-pending' : inc.status;
          const st = STATUS[realStatus] || { label: realStatus, color: '#8b949e' };
          const isResolved = inc.status === 'resolved';
          return (
            <div key={inc.id} className="iq-entry" style={isResolved ? { opacity: 0.5 } : {}}>
              <div className="iq-row" onClick={() => setSelected(expanded ? null : inc.id)}>
                <span className="iq-pri" style={{ color: pri.color }}>{pri.label}</span>
                <span className="iq-desc">{inc.type.replace(/_/g, ' ')}</span>
                <span className="iq-st" style={{ color: st.color }}>{st.label}</span>
              </div>
              {expanded && (
                <div className="iq-detail">
                  <div className="iq-detail-row"><span className="iq-label">what</span>{inc.description}</div>
                  <div className="iq-detail-row"><span className="iq-label">where</span>{inc.location.name}</div>
                  <div className="iq-detail-row"><span className="iq-label">when</span>{fmt(inc.created_at)} ({elapsed(inc.created_at)} ago)</div>
                  <div className="iq-detail-row"><span className="iq-label">status</span><span style={{ color: st.color }}>{st.label}</span></div>
                  {inc.assigned_to && inc.assigned_to !== 'ai-pending' ? (
                    <div className="iq-detail-row"><span className="iq-label">drone</span>{inc.assigned_to} (deployed {fmt(inc.updated_at)})</div>
                  ) : (
                    <div className="iq-detail-row"><span className="iq-label">drone</span><span style={{ color: '#484f58' }}>none assigned</span></div>
                  )}
                  <div className="iq-detail-row"><span className="iq-label">ai</span>
                    {realStatus === 'new' ? <span style={{ color: '#58a6ff' }}>waiting for AI</span>
                    : realStatus === 'ai-pending' ? <span style={{ color: '#bc8cff' }}>AI responded, no drone assigned yet</span>
                    : inc.assigned_to && inc.assigned_to !== 'ai-pending' ? <span style={{ color: '#3fb950' }}>dispatched {inc.assigned_to}</span>
                    : <span style={{ color: '#484f58' }}>pending</span>}
                  </div>
                  {inc.status === 'on_scene' && (
                    <div className="iq-detail-row">
                      <button
                        className="iq-btn"
                        onClick={() => resolveIncident(inc.id)}
                        style={{
                          background: '#3fb950',
                          color: '#0d1117',
                          fontWeight: 'bold',
                          padding: '8px 16px',
                          border: 'none',
                          borderRadius: '4px',
                          cursor: 'pointer',
                          marginTop: '8px'
                        }}
                      >
                        🏁 RESOLVE
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default IncidentQueue;
