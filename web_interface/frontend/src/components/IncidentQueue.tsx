import React from 'react';
import { Incident } from '../hooks/useDispatchState';
import './IncidentQueue.css';

interface IncidentQueueProps {
  incidents: Incident[];
  connected: boolean;
}

const PRIORITY_LABELS: Record<number, { label: string; color: string }> = {
  1: { label: 'P1', color: '#f85149' },
  2: { label: 'P2', color: '#d29922' },
  3: { label: 'P3', color: '#3fb950' },
};

const STATUS_LABELS: Record<string, { label: string; class: string }> = {
  new:        { label: 'NEW',        class: 'status-new' },
  dispatched: { label: 'DISPATCHED', class: 'status-dispatched' },
  on_scene:   { label: 'ON SCENE',   class: 'status-onscene' },
  resolved:   { label: 'RESOLVED',   class: 'status-resolved' },
};

const TYPE_ICONS: Record<string, string> = {
  medical_emergency:   '🏥',
  structure_fire:      '🔥',
  traffic_accident:    '🚗',
  suspicious_activity: '🔍',
  missing_person:      '👤',
  noise_complaint:     '🔊',
  property_damage:     '🏚️',
};

function timeAgo(isoDate: string): string {
  const seconds = Math.floor((Date.now() - new Date(isoDate).getTime()) / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  return `${Math.floor(seconds / 3600)}h ago`;
}

const IncidentQueue: React.FC<IncidentQueueProps> = ({ incidents, connected }) => {
  return (
    <div className="incident-queue">
      <div className="incident-queue-header">
        <span>INCIDENTS</span>
        <span className={`dispatch-status ${connected ? 'online' : 'offline'}`}>
          {connected ? '● CAD' : '○ CAD'}
        </span>
      </div>
      <div className="incident-list">
        {incidents.length === 0 && (
          <div className="incident-empty">
            {connected ? 'No active incidents' : 'Dispatch service offline'}
          </div>
        )}
        {incidents.map((inc) => {
          const pri = PRIORITY_LABELS[inc.priority] || { label: '?', color: '#8b949e' };
          const status = STATUS_LABELS[inc.status] || { label: inc.status, class: '' };
          const icon = TYPE_ICONS[inc.type] || '📋';
          const isResolved = inc.status === 'resolved';

          return (
            <div
              key={inc.id}
              className={`incident-card ${isResolved ? 'resolved' : ''} priority-${inc.priority}`}
            >
              <div className="incident-card-top">
                <span className="incident-icon">{icon}</span>
                <span className="incident-priority" style={{ color: pri.color }}>
                  {pri.label}
                </span>
                <span className="incident-id">{inc.id}</span>
                <span className={`incident-status ${status.class}`}>
                  {status.label}
                </span>
              </div>
              <div className="incident-description">{inc.description}</div>
              <div className="incident-card-bottom">
                <span className="incident-location">📍 {inc.location.name}</span>
                <span className="incident-time">{timeAgo(inc.created_at)}</span>
              </div>
              {inc.assigned_to && (
                <div className="incident-assigned">
                  🛸 {inc.assigned_to}
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
