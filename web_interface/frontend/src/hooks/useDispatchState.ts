import { useState, useEffect, useRef } from 'react';

export interface Incident {
  id: string;
  type: string;
  priority: number;
  description: string;
  location: { name: string; x: number; y: number };
  status: string;
  created_at: string;
  updated_at: string;
  assigned_to: string | null;
}

const DISPATCH_API = '';
const POLL_INTERVAL = 3000; // 3s

export function useDispatchState() {
  const [incidents, setIncidents] = useState<Incident[]>([]);
  const [connected, setConnected] = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    const poll = async () => {
      try {
        const res = await fetch(`${DISPATCH_API}/api/incidents`);
        if (res.ok) {
          const data = await res.json();
          setIncidents(data);
          setConnected(true);
        } else {
          setConnected(false);
        }
      } catch {
        setConnected(false);
      }
    };

    poll();
    intervalRef.current = setInterval(poll, POLL_INTERVAL);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, []);

  const activeIncidents = incidents.filter(i => i.status !== 'resolved');
  const sortedIncidents = [...incidents].sort((a, b) => {
    // Newest first (stable sort by creation time only)
    return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
  });

  return { incidents: sortedIncidents, activeIncidents, connected };
}
