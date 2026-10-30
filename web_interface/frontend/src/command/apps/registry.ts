// Jobs: what a drone does beyond being flown by hand (patrol, dispatch, ...).
// A drone has at most one job at a time. Each job type is one file here (the UI part of a
// plugin, see docs/design/plugins.md): a Planner to start it, a Live view while it runs,
// and a Report for one finished job (Reports tab). Job code talks to drones only through the fleet API.
import React from 'react';
import { FleetDrone } from '../../api/fleet';
import { LatLon } from '../geo';
import { PatrolStatus } from '../status';

export interface Job {
  id: string; drone: string; plugin: string; operator: string; started: string; ended: string | null;
  status: 'running' | 'ended'; result: 'completed' | 'stopped' | 'failed' | null; reason: string; text: string;
  links: Record<string, string>; args: Record<string, any>;
}

/** Something a job draws on the map, in meters north/east of the selected drone's home. */
/** Position: north/east meters from home, or lat/lon (e.g. where a photo was actually taken). */
type At = { north?: number; east?: number; lat?: number; lon?: number };
export type Shape = { id?: string; color?: string; label?: string } & (
  | ({ type: 'circle'; radius: number } & At)
  | { type: 'line'; points: Array<[number, number]>; closed?: boolean; dashed?: boolean }
  | ({ type: 'marker'; clickable?: boolean } & At)
  | ({ type: 'photo'; n: number } & At)
  | { type: 'route'; points: Array<[number, number]>; editable?: boolean; kind?: 'draft' | 'active'; closed?: boolean });

/** What a job hears back from the map: shape clicks/edits, and map clicks while it listens. */
export interface MapHandlers {
  onShape?: (shape: Shape, ev: { kind: 'click' } | { kind: 'edit'; points: Array<[number, number]> }) => void;
  /** Set to listen for map clicks (with this hint shown on the map). */
  onClick?: (p: { north: number; east: number }) => void;
  clickHint?: string;
}

export interface AppCtx {
  drone: string;
  d?: FleetDrone;
  home: LatLon | null;
  operator: string;
  busy: boolean;
  /** Run a fleet API call with a toast and a log refresh; resolves true on success. */
  run: (label: string, fn: () => Promise<{ message?: string }>) => Promise<boolean>;
  returnHome: () => void;
  /** The drone's onboard mission, straight from drone_core (item, items, running, paused, progress), or null. */
  mission: PatrolStatus | null;
  /** The drone's current job from the fleet API (one per drone), or null. */
  job: Job | null;
  /** The shared map: ask for a click, or draw shapes (with handlers for clicks/edits). */
  map: {
    /** Ask the operator to click a point on the map; resolves with it (meters from the drone's home), or null if cancelled. */
    pick: (prompt: string) => Promise<{ north: number; east: number } | null>;
    /** Draw shapes from the screen that's open (replaces what it drew before; [] clears). */
    draw: (shapes: Shape[], handlers?: MapHandlers) => void;
  };
  /** The fleet API (same as the command center uses): api('GET', '/drones/drone1'). */
  api: <T = any>(method: string, path: string, body?: unknown) => Promise<T>;
  geofenceRadius: number | null;
}

export interface JobType {
  id: string;
  name: string;
  icon: string;
  /** Hook: a short status if the drone is doing this job right now, else null. */
  useActive: (ctx: AppCtx) => string | null;
  Planner: React.FC<{ ctx: AppCtx }>;
  Live: React.FC<{ ctx: AppCtx }>;
  /** Reports tab: the report of one finished job of this type (opened from the jobs list). */
  Report?: React.FC<{ ctx: AppCtx; job: Job }>;
  /** Shapes to show on the map while the drone is doing this job (any tab). Pure, no hooks. */
  overlay?: (ctx: AppCtx) => Shape[];
}
export type DroneApp = JobType;

// Built-in job UIs: none. Every plugin ships its own (see external.ts): Patrol, Dispatch, Inspect...
export const JOBS: JobType[] = [];
