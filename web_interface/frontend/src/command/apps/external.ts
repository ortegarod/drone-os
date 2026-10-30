// Plugin screens loaded from the plugin itself (manifest "ui": "<path on the plugin service>").
//
// A plugin's UI is one plain ES module (no build step needed) served by the plugin and reached
// through the fleet API proxy: /api/v1/plugins/<id>/<ui path>. It gets React and the command
// center's helpers from window.DroneOS (below) and default-exports:
//
//   export default { Planner, Live, Report, overlay, status }
//   Report gets { ctx, job }: one finished job of this plugin, opened from the Reports tab's jobs list
//   components get { ctx }; overlay(ctx) -> shapes on the map while on the job; status(ctx) -> short text
//
// ctx is the same AppCtx the built-in jobs get (drone, d, job, run, api, map.pick, ...).
// Built-in UIs ("ui": "builtin:<id>") stay in src/command/apps.
import React from 'react';
import { api, command, getKey } from '../../api/fleet';
import type { AppCtx, JobType } from './registry';

export interface PluginInfo { id: string; name: string; version?: string | null; description?: string; ui?: string | null; operator?: string; source?: 'bundled' | 'installed' }

// Authenticated image/blob from the fleet API (an <img src> can't send the key): -> object URL, cached.
const authHeader = () => ['Bea', 'rer ', getKey()].join('');
const blobs = new Map<string, Promise<string>>();
const blobUrl = (path: string): Promise<string> => {
  if (!blobs.has(path)) {
    blobs.set(path, fetch('/api/v1' + path, { headers: { Authorization: authHeader() } })
      .then(r => { if (!r.ok) throw new Error(r.statusText); return r.blob(); })
      .then(b => URL.createObjectURL(b))
      .catch(e => { blobs.delete(path); throw e; }));
  }
  return blobs.get(path)!;
};

(window as any).DroneOS = { React, h: React.createElement, api, command, blobUrl, version: 1 };

const Missing: React.FC<{ ctx: AppCtx }> = () => null;

/** Load one plugin's UI module; null if it has none or it fails (the error is logged). */
export async function loadPluginUi(p: PluginInfo): Promise<JobType | null> {
  if (!p.ui || p.ui.startsWith('builtin:')) return null;
  try {
    const path = p.ui.replace(/^\/+/, '');
    const res = await fetch(`/api/v1/plugins/${p.id}/${path}`, { headers: { Authorization: 'Bearer ' + getKey() } });
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
    const url = URL.createObjectURL(new Blob([await res.text()], { type: 'text/javascript' }));
    // Native import of the plugin's module (kept out of the bundler on purpose).
    const mod = await (new Function('u', 'return import(u)'))(url);
    URL.revokeObjectURL(url);
    const ui = mod.default || {};
    return {
      id: p.id,
      name: p.name || p.id,
      icon: '',
      // Not a hook: external jobs are "active" when the fleet API says the drone's job is theirs.
      useActive: ctx => {
        if (ctx.job?.plugin !== p.id) return null;
        try { return (typeof ui.status === 'function' && ui.status(ctx)) || ctx.job.text || 'running'; } catch { return ctx.job.text || 'running'; }
      },
      Planner: ui.Planner || Missing,
      Live: ui.Live || Missing,
      Report: ui.Report || undefined,
      overlay: typeof ui.overlay === 'function' ? (ctx => { try { return ui.overlay(ctx) || []; } catch { return []; } }) : undefined,
    };
  } catch (e) {
    console.error(`plugin ${p.id}: UI failed to load`, e);
    return null;
  }
}
