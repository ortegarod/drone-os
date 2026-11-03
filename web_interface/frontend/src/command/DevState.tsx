// Dev tab: raw telemetry + API health.
import React, { useEffect, useState } from 'react';
import type { FleetDrone } from '../api/fleet';

interface Props {
  drone: string;
  d?: FleetDrone;
  connected: boolean;
  socket: boolean;
}

const DevState: React.FC<Props> = ({ drone, d, connected, socket }) => {
  const [health, setHealth] = useState<any>(null);
  useEffect(() => {
    fetch('/api/v1/health').then(r => r.json()).then(setHealth).catch(() => setHealth(null));
  }, [drone]);
  return (
    <div className="mn-block">
      <div className="cc-hint">
        Telemetry socket {socket ? 'open' : 'closed'} · fleet API {connected ? 'connected to drone_core' : 'not connected'}
        {health ? ` · ${health.drones} drones` : ''}
      </div>
      <pre className="mn-raw">{d ? JSON.stringify(d.raw ?? d, null, 1) : 'no data'}</pre>
    </div>
  );
};

export default DevState;
