import React, { useState, useRef, useCallback, useEffect } from 'react';
import AIInterface from './AIInterface';
import ActivityFeed from './ActivityFeed';
import MiniMap from './MiniMap';
import MapModal from './MapModal';
import DroneMenu from './DroneMenu';
import SimpleCameraFeed from './SimpleCameraFeed';
import IncidentQueue from './IncidentQueue';
import { Badge } from './ui/badge';
import { useDispatchState } from '../hooks/useDispatchState';
import { DroneStatus } from '../types/drone';
import './FleetDashboard.css';

interface FleetDashboardProps {
  droneAPI: any;
  droneStatus: DroneStatus;
  availableDrones: string[];
  isConnected: boolean;
  setTargetDrone: (name: string) => void;
  targetAltitude: number;
  setTargetAltitude: (alt: number) => void;
  maxAltitude: number;
  setMaxAltitude: (alt: number) => void;
  opsState: string;
}

const FleetDashboard: React.FC<FleetDashboardProps> = ({
  droneAPI,
  droneStatus,
  availableDrones,
  isConnected,
  setTargetDrone,
  targetAltitude,
  setTargetAltitude,
  maxAltitude,
  setMaxAltitude,
  opsState,
}) => {
  const { incidents, connected: dispatchConnected } = useDispatchState();
  const [consoleInput, setConsoleInput] = useState('');
  const [isMapModalOpen, setIsMapModalOpen] = useState(false);
  const [consoleHistory, setConsoleHistory] = useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [consoleOutput, setConsoleOutput] = useState<Array<{ text: string; type: 'cmd' | 'ok' | 'err' | 'info' }>>([
    { text: 'DroneOS Console v1.0 — type "help" for commands', type: 'info' },
  ]);
  const [commandOverlay, setCommandOverlay] = useState<{
    state?: string;
    message?: string;
    target?: { label?: string; x?: number; y?: number; z?: number };
    telemetry?: { x?: number; y?: number; z?: number };
    mode?: string;
    armed?: boolean;
  }>({});
  const consoleOutputRef = useRef<HTMLDivElement>(null);
  const [allDroneStates, setAllDroneStates] = useState<Record<string, any>>({});

  // Poll all drone states
  useEffect(() => {
    if (!droneAPI?.ros || availableDrones.length === 0) return;
    const ROSLIB = require('roslib');
    const subs: any[] = [];
    availableDrones.forEach(name => {
      const topic = new ROSLIB.Topic({
        ros: droneAPI.ros,
        name: `/${name}/drone_state`,
        messageType: 'drone_interfaces/DroneState',
        throttle_rate: 500,
        queue_length: 1,
      });
      topic.subscribe((msg: any) => {
        setAllDroneStates(prev => ({ ...prev, [name]: msg }));
      });
      subs.push(topic);
    });
    return () => subs.forEach(t => t.unsubscribe());
  }, [droneAPI?.ros, availableDrones]);

  const executeCommand = useCallback(async (cmd: string) => {
    const trimmed = cmd.trim();
    if (!trimmed) return;

    setConsoleHistory(prev => [...prev, trimmed]);
    setHistoryIndex(-1);
    setConsoleOutput(prev => [...prev, { text: `> ${trimmed}`, type: 'cmd' }]);

    const parts = trimmed.split(/\s+/);
    const command = parts[0].toLowerCase();

    try {
      switch (command) {
        case 'help':
          setConsoleOutput(prev => [...prev,
            { text: 'Commands: arm, disarm, offboard, land, pos <x> <y> <z>, state, help, clear', type: 'info' },
          ]);
          break;

        case 'arm': {
          const r = await droneAPI.arm();
          setConsoleOutput(prev => [...prev, { text: r.success ? 'Armed ✓' : `Arm failed: ${r.message}`, type: r.success ? 'ok' : 'err' }]);
          break;
        }

        case 'disarm': {
          const r = await droneAPI.disarm();
          setConsoleOutput(prev => [...prev, { text: r.success ? 'Disarmed ✓' : `Disarm failed: ${r.message}`, type: r.success ? 'ok' : 'err' }]);
          break;
        }

        case 'offboard': {
          const r = await droneAPI.setOffboard();
          setConsoleOutput(prev => [...prev, { text: r.success ? 'Offboard mode set ✓' : `Offboard failed: ${r.message}`, type: r.success ? 'ok' : 'err' }]);
          break;
        }

        case 'land': {
          const r = await droneAPI.land();
          setConsoleOutput(prev => [...prev, { text: r.success ? 'Landing ✓' : `Land failed: ${r.message}`, type: r.success ? 'ok' : 'err' }]);
          break;
        }

        case 'pos': {
          const x = parseFloat(parts[1]);
          const y = parseFloat(parts[2]);
          const z = parseFloat(parts[3]);
          if (isNaN(x) || isNaN(y) || isNaN(z)) {
            setConsoleOutput(prev => [...prev, { text: 'Usage: pos <x> <y> <z>', type: 'err' }]);
            break;
          }
          const r = await droneAPI.setPosition(x, y, z, 0);
          setConsoleOutput(prev => [...prev, { text: r.success ? `Position set: ${x}, ${y}, ${z} ✓` : `Position failed: ${r.message}`, type: r.success ? 'ok' : 'err' }]);
          break;
        }

        case 'state': {
          const r = await droneAPI.getState();
          if (r.success) {
            setConsoleOutput(prev => [...prev,
              { text: `Mode: ${r.nav_state || 'unknown'} | Armed: ${r.arming_state || 'UNKNOWN'} | Alt: ${(-r.local_z || 0).toFixed(1)}m | Bat: ${((r.battery_remaining || 0) * 100).toFixed(0)}%`, type: 'info' },
            ]);
          } else {
            setConsoleOutput(prev => [...prev, { text: 'Failed to get state', type: 'err' }]);
          }
          break;
        }

        case 'clear':
          setConsoleOutput([{ text: 'DroneOS Console v1.0', type: 'info' }]);
          break;

        default:
          setConsoleOutput(prev => [...prev, { text: `Unknown command: ${command}`, type: 'err' }]);
      }
    } catch (err: any) {
      setConsoleOutput(prev => [...prev, { text: `Error: ${err?.message || 'unknown'}`, type: 'err' }]);
    }

    setTimeout(() => {
      if (consoleOutputRef.current) {
        consoleOutputRef.current.scrollTop = consoleOutputRef.current.scrollHeight;
      }
    }, 50);
  }, [droneAPI]);

  const handleConsoleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      executeCommand(consoleInput);
      setConsoleInput('');
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (consoleHistory.length > 0) {
        const newIndex = historyIndex === -1 ? consoleHistory.length - 1 : Math.max(0, historyIndex - 1);
        setHistoryIndex(newIndex);
        setConsoleInput(consoleHistory[newIndex]);
      }
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (historyIndex >= 0) {
        const newIndex = historyIndex + 1;
        if (newIndex >= consoleHistory.length) {
          setHistoryIndex(-1);
          setConsoleInput('');
        } else {
          setHistoryIndex(newIndex);
          setConsoleInput(consoleHistory[newIndex]);
        }
      }
    }
  };

  // Translate raw PX4 state into a human-readable status
  const getDroneDisplayStatus = (st: any): { label: string; className: string } => {
    if (!st) return { label: 'Offline', className: 'status-offline' };
    const mode = (st.nav_state || st.flight_mode || '').toUpperCase();
    const armed = st.arming_state === 'ARMED';
    const alt = -(st.local_z || 0);
    const airborne = alt > 1.0;

    if (mode.includes('LAND')) return { label: 'Landing', className: 'status-landing' };
    if (mode.includes('RTL') || mode.includes('RETURN')) return { label: 'Returning', className: 'status-returning' };
    if (mode.includes('TAKEOFF')) return { label: 'Takeoff', className: 'status-takeoff' };
    if (armed && airborne) return { label: 'In Flight', className: 'status-mission' };
    if (armed) return { label: 'Armed', className: 'status-armed' };
    return { label: 'Ready', className: 'status-ready' };
  };

  return (
    <div className="fleet-wrapper">
      <div className="fleet-layout">
        {/* Left — Fleet + Incidents */}
        <aside className="fleet-sidebar">
          <div className="fleet-list-header">DRONE FLEET</div>
          <div className="fleet-list">
            {availableDrones.map((drone) => {
              const isActive = drone === droneStatus.drone_name;
              const st = allDroneStates[drone];
              const alt = st ? (-st.local_z || 0).toFixed(0) : '—';
              const bat = st?.battery_remaining != null ? (st.battery_remaining * 100).toFixed(0) : '—';
              const displayStatus = getDroneDisplayStatus(st);
              return (
                <div
                  key={drone}
                  className={`fleet-drone-card ${isActive ? 'active' : ''}`}
                  onClick={() => setTargetDrone(drone)}
                >
                  <div className="drone-card-indicator" />
                  <span className="drone-card-name">{drone}</span>
                  <span className={`drone-card-state ${displayStatus.className}`}>{displayStatus.label}</span>
                  <span className="drone-card-telem">{alt}m</span>
                  <span className="drone-card-telem">{bat}%</span>
                  <div className={`drone-card-status ${st ? 'online' : 'idle'}`}>
                    {st ? '●' : '○'}
                  </div>
                </div>
              );
            })}
            {availableDrones.length === 0 && (
              <div className="fleet-empty">No drones discovered</div>
            )}
          </div>
          <IncidentQueue incidents={incidents} connected={dispatchConnected} />
        </aside>

        {/* Center — Camera + AI Chat */}
        <main className="fleet-viewport">
          <div className="viewport-camera">
            <SimpleCameraFeed
              droneAPI={droneAPI}
              isConnected={isConnected}
              droneStatus={droneStatus}
              commandOverlay={commandOverlay}
              availableDrones={availableDrones}
              setTargetDrone={setTargetDrone}
            />
          </div>
          <div className="viewport-chat" style={{ position: 'relative' }}>
            <AIInterface
              droneAPI={droneAPI}
              droneStatus={droneStatus}
              onCommandUpdate={setCommandOverlay}
            />
          </div>
        </main>

        {/* Right — Map + Controls */}
        <aside className="fleet-control">
          <div className="control-map">
            <div className="section-header">MAP</div>
            <MiniMap
              droneAPI={droneAPI}
              droneStatus={droneStatus}
              availableDrones={availableDrones}
              targetAltitude={targetAltitude}
              onExpand={() => setIsMapModalOpen(true)}
            />
          </div>
          <div className="control-menu">
            <div className="section-header">
              CONTROLS
              <Badge className={`ops-badge ops-${opsState.toLowerCase()}`} style={{ marginLeft: '8px', fontSize: '9px' }}>
                {opsState}
              </Badge>
            </div>
            <DroneMenu
              droneAPI={droneAPI}
              droneStatus={droneStatus}
              availableDrones={availableDrones}
              isConnected={isConnected}
              targetAltitude={targetAltitude}
              setTargetAltitude={setTargetAltitude}
              maxAltitude={maxAltitude}
              setMaxAltitude={setMaxAltitude}
            />
          </div>
          <div className="control-ai">
            <ActivityFeed />
          </div>
        </aside>
      </div>

      {/* Console Footer */}
      <footer className="fleet-console">
        <div className="console-output" ref={consoleOutputRef}>
          {consoleOutput.map((line, i) => (
            <div key={i} className={`console-line console-${line.type}`}>{line.text}</div>
          ))}
        </div>
        <div className="console-input-row">
          <span className="console-prompt">{'>'}</span>
          <input
            type="text"
            className="console-input"
            value={consoleInput}
            onChange={(e) => setConsoleInput(e.target.value)}
            onKeyDown={handleConsoleKeyDown}
            placeholder="arm, offboard, pos 0 0 -15, land, state, help"
            spellCheck={false}
            autoComplete="off"
          />
        </div>
      </footer>

      {/* Map Modal */}
      <MapModal
        isOpen={isMapModalOpen}
        onClose={() => setIsMapModalOpen(false)}
        droneAPI={droneAPI}
        droneStatus={droneStatus}
        availableDrones={availableDrones}
        targetAltitude={targetAltitude}
      />
    </div>
  );
};

export default FleetDashboard;
