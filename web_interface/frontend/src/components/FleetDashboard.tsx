import React, { useState, useRef, useCallback } from 'react';
import AIInterface from './AIInterface';
import MiniMap from './MiniMap';
import DroneMenu from './DroneMenu';
import SimpleCameraFeed from './SimpleCameraFeed';
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
}) => {
  const [consoleInput, setConsoleInput] = useState('');
  const [consoleHistory, setConsoleHistory] = useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [consoleOutput, setConsoleOutput] = useState<Array<{ text: string; type: 'cmd' | 'ok' | 'err' | 'info' }>>([
    { text: 'DroneOS Console v1.0 — type "help" for commands', type: 'info' },
  ]);
  const consoleOutputRef = useRef<HTMLDivElement>(null);

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

  return (
    <div className="fleet-wrapper">
      <div className="fleet-layout">
        {/* Left — Fleet List */}
        <aside className="fleet-sidebar">
          <div className="fleet-list-header">FLEET</div>
          <div className="fleet-list">
            {availableDrones.map((drone) => {
              const isActive = drone === droneStatus.drone_name;
              return (
                <div
                  key={drone}
                  className={`fleet-drone-card ${isActive ? 'active' : ''}`}
                  onClick={() => setTargetDrone(drone)}
                >
                  <div className="drone-card-indicator" />
                  <div className="drone-card-body">
                    <div className="drone-card-name">{drone}</div>
                    {isActive && (
                      <div className="drone-card-stats">
                        <span className={`drone-card-armed ${droneStatus.armed ? 'yes' : ''}`}>
                          {droneStatus.armed ? 'ARMED' : 'DISARMED'}
                        </span>
                        <span className="drone-card-alt">
                          ALT {(-droneStatus.position.z || 0).toFixed(0)}m
                        </span>
                      </div>
                    )}
                  </div>
                  <div className={`drone-card-status ${isActive ? 'online' : 'idle'}`}>
                    {isActive ? '●' : '○'}
                  </div>
                </div>
              );
            })}
            {availableDrones.length === 0 && (
              <div className="fleet-empty">No drones discovered</div>
            )}
          </div>
        </aside>

        {/* Center — Camera + AI Chat */}
        <main className="fleet-viewport">
          <div className="viewport-camera">
            <SimpleCameraFeed
              droneAPI={droneAPI}
              isConnected={isConnected}
              droneStatus={droneStatus}
            />
          </div>
          <div className="viewport-chat">
            <AIInterface droneAPI={droneAPI} droneStatus={droneStatus} />
          </div>
        </main>

        {/* Right — Map + Controls */}
        <aside className="fleet-control">
          <div className="control-map">
            <MiniMap
              droneAPI={droneAPI}
              droneStatus={droneStatus}
              availableDrones={availableDrones}
              targetAltitude={targetAltitude}
            />
          </div>
          <div className="control-menu">
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
        </aside>
      </div>

      {/* Console Footer */}
      <footer className="fleet-console">
        <div className="console-target">TARGET: {droneStatus.drone_name || 'none'}</div>
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
    </div>
  );
};

export default FleetDashboard;
