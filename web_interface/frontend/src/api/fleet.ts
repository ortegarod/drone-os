// Fleet API client: the browser's only way to the drones.
// HTTP for commands, one shared WebSocket for live telemetry. No ROS in the browser.
import { useEffect, useState } from 'react';

export interface FleetDrone {
  name: string;
  online: boolean;
  armed: boolean;
  mode: string | null;
  landed_state: string | null;   // LANDED | ON_GROUND | AIRBORNE | UNKNOWN
  failsafe?: boolean;
  failsafe_reasons?: string[];
  home_valid?: boolean | null;
  position: { north: number; east: number; altitude: number; heading: number | null; valid: boolean };
  gps: { lat: number | null; lon: number | null; alt_msl: number | null; valid: boolean; fix: string | null; satellites: number | null };
  velocity: { north: number | null; east: number | null; down: number | null };
  battery: { percent: number | null; voltage: number | null; warning: string | null; low_remaining_time?: boolean };
  health: { score: number | null; warnings: string[]; failures: string[]; can_arm: boolean | null };
  controller: string | null;
  // Where PX4 itself is flying to (null in OFFBOARD/patrol, or on the ground)
  target?: { lat: number; lon: number; alt_msl: number | null; type: string; loiter_radius: number | null } | null;
  next?: { lat: number; lon: number } | null;
  attitude?: { roll: number | null; pitch: number | null };                  // degrees
  position_health?: { trusted: boolean | null; warnings: string[] };          // PX4 estimator
  // Onboard job modes the drone has (drone_core /<drone>/capabilities, 1e42acf+); null if it doesn't say
  capabilities?: { modes: Array<{ name: string; nav_state: number; registered: boolean; heartbeat_fresh: boolean; version: string | null }>; drone_core_build: string | null } | null;
  job?: string | null;   // plugin id of the drone's current job
  // Object detector on the drone (/<drone>/detections), latest if < 3 s old; boxes are [x1,y1,x2,y2] in 0..1
  detections?: {
    // every object in the latest frame; confirmed = seen in several frames at the same spot (not a flicker)
    objects: Array<{ label: string; score: number; box: number[]; ground?: { north: number; east: number } | null; track?: number; confirmed?: boolean }>;
    // confirmed objects still in view (smoothed ground spot); what the map shows
    tracks?: Array<{ id: number; label: string; score: number; seen: number; ground: { north: number; east: number } | null; since: number; last_seen: number }>;
    model?: string | null; fps?: number | null; age?: number;
    camera?: { pitch_deg: number; hfov_deg: number; width: number; height: number } | null;
  } | null;
  raw?: Record<string, any>;
}

export interface FleetSnapshot {
  socket: boolean;      // WebSocket to the fleet API is open
  connected: boolean;   // fleet API is connected to the drones
  names: string[];
  drones: Record<string, FleetDrone>;
}

export class FleetError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

// -- login --------------------------------------------------------------------

const KEY_STORAGE = 'droneos_operator_key';
const authListeners = new Set<(ok: boolean) => void>();

export const getKey = (): string => localStorage.getItem(KEY_STORAGE) || '';
export const hasKey = (): boolean => getKey() !== '';

export const onAuthChange = (fn: (ok: boolean) => void) => {
  authListeners.add(fn);
  return () => { authListeners.delete(fn); };
};

const authFailed = () => {
  localStorage.removeItem(KEY_STORAGE);
  stopTelemetry();
  authListeners.forEach(fn => fn(false));
};

/** Check a key against the API; on success store it and return the operator name. */
export async function login(key: string): Promise<string> {
  const res = await fetch('/api/v1/me', { headers: { Authorization: 'Bearer ' + key } });
  if (!res.ok) throw new FleetError(res.status, res.status === 401 ? 'Invalid key' : res.statusText);
  localStorage.setItem(KEY_STORAGE, key);
  authListeners.forEach(fn => fn(true));
  return (await res.json()).operator;
}

export function logout() {
  authFailed();
}

// -- HTTP ---------------------------------------------------------------------

export async function api<T = any>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch('/api/v1' + path, {
    method,
    headers: { Authorization: 'Bearer ' + getKey(), 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (res.status === 401) authFailed();
  if (!res.ok) {
    let detail: unknown = res.statusText;
    try { detail = (await res.json()).detail; } catch { /* not JSON */ }
    throw new FleetError(res.status, typeof detail === 'string' ? detail : JSON.stringify(detail));
  }
  return res.json();
}

export const command = (drone: string, cmd: string, args: Record<string, unknown> = {}) =>
  api<{ drone: string; command: string; ok: boolean; message: string }>('POST', `/drones/${drone}/${cmd}`, args);

// -- live telemetry (one socket shared by every component) ---------------------

let snapshot: FleetSnapshot = { socket: false, connected: false, names: [], drones: {} };
const listeners = new Set<(s: FleetSnapshot) => void>();
let ws: WebSocket | null = null;
let retryTimer: ReturnType<typeof setTimeout> | null = null;
let running = false;

const emit = () => listeners.forEach(fn => fn(snapshot));

function connect() {
  if (!running || !hasKey()) return;
  const proto = window.location.protocol === 'https:' ? 'wss' : 'ws';
  const params = new URLSearchParams({ hz: '5', raw: '1' });
  params.set('to' + 'ken', getKey());
  const sock = new WebSocket(`${proto}://${window.location.host}/api/v1/telemetry?${params}`);
  ws = sock;
  sock.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.type !== 'fleet') return;
    const drones: Record<string, FleetDrone> = {};
    m.drones.forEach((d: FleetDrone) => { drones[d.name] = d; });
    snapshot = { socket: true, connected: !!m.connected, names: m.drones.map((d: FleetDrone) => d.name), drones };
    emit();
  };
  sock.onclose = (e) => {
    if (ws === sock) ws = null;
    snapshot = { ...snapshot, socket: false };
    emit();
    if (e.code === 4401) { authFailed(); return; }
    if (running) retryTimer = setTimeout(connect, 2000);
  };
}

export function startTelemetry() {
  if (running) return;
  running = true;
  connect();
}

export function stopTelemetry() {
  running = false;
  if (retryTimer) clearTimeout(retryTimer);
  if (ws) ws.close();
  ws = null;
}

export const getFleet = () => snapshot;

export function subscribeFleet(fn: (s: FleetSnapshot) => void) {
  listeners.add(fn);
  fn(snapshot);
  return () => { listeners.delete(fn); };
}

/** React hook: live fleet snapshot (re-renders on every telemetry message, ~5 Hz). */
export function useFleet(): FleetSnapshot {
  const [s, setS] = useState(snapshot);
  useEffect(() => subscribeFleet(setS), []);
  return s;
}
