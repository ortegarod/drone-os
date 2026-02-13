import { useState, useEffect, useRef, useCallback } from 'react';

const BRIDGE_API = 'http://' + window.location.hostname + ':8082';
const POLL_INTERVAL = 3000;

export interface BridgeStatus {
  paused: boolean;
  running: boolean;
  seen_count: number;
  activity_log: Array<{ time: number; message: string }>;
}

export function useBridgeState() {
  const [status, setStatus] = useState<BridgeStatus | null>(null);
  const [connected, setConnected] = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const poll = useCallback(async () => {
    try {
      const res = await fetch(`${BRIDGE_API}/api/bridge/status`);
      if (res.ok) {
        setStatus(await res.json());
        setConnected(true);
      } else {
        setConnected(false);
      }
    } catch {
      setConnected(false);
    }
  }, []);

  useEffect(() => {
    poll();
    intervalRef.current = setInterval(poll, POLL_INTERVAL);
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [poll]);

  const toggle = useCallback(async () => {
    try {
      const res = await fetch(`${BRIDGE_API}/api/bridge/toggle`, { method: 'POST' });
      if (res.ok) {
        const data = await res.json();
        setStatus(prev => prev ? { ...prev, paused: data.paused } : null);
      }
    } catch { /* ignore */ }
  }, []);

  return { status, connected, toggle };
}
