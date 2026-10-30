// Dev tab: the plugins the fleet API has, install one while everything runs, remove one.
// Installing returns the plugin's own operator token once; the plugin's service needs it.
import React, { useState } from 'react';
import { api } from '../api/fleet';
import type { PluginInfo } from './apps/external';

const EXAMPLE = `{
  "id": "spot",
  "name": "Spot check",
  "version": "0.1.0",
  "description": "Fly to a point, take a photo, come home.",
  "service_url": "http://127.0.0.1:8093",
  "ui": "/ui/job.js"
}`;

const PluginAdmin: React.FC<{ plugins: PluginInfo[]; reload: () => void; note: (text: string, ok: boolean) => void }> = ({ plugins, reload, note }) => {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState(EXAMPLE);
  const [issued, setIssued] = useState<{ id: string; operator: string; token: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const install = async () => {
    let manifest: unknown;
    try { manifest = JSON.parse(text); } catch (e) { note('Manifest is not valid JSON: ' + (e as Error).message, false); return; }
    setBusy(true);
    try {
      const r = await api<{ plugin: PluginInfo & { operator?: string }; created: boolean; reachable: boolean; token: string | null }>('POST', '/plugins', manifest);
      if (r.token) setIssued({ id: r.plugin.id, operator: r.plugin.operator || r.plugin.id, token: r.token });
      note(`${r.created ? 'Installed' : 'Updated'} ${r.plugin.name}${r.reachable ? '' : ' (its service is not answering yet)'}`, true);
      setOpen(false);
      reload();
    } catch (e) { note((e as Error).message, false); }
    setBusy(false);
  };
  const remove = async (p: PluginInfo) => {
    if (!window.confirm(`Remove the ${p.name} plugin? Its token stops working.`)) return;
    setBusy(true);
    try { await api('DELETE', '/plugins/' + p.id); note(`Removed ${p.name}`, true); if (issued?.id === p.id) setIssued(null); reload(); }
    catch (e) { note((e as Error).message, false); }
    setBusy(false);
  };

  return (
    <div className="mn-block pl-admin">
      <div className="mn-title">Plugins <span className="cc-sub">job types; install or remove without restarting anything</span></div>
      {plugins.map(p => (
        <div key={p.id} className="pl-row" data-plugin={p.id}>
          <span className="pl-name">{p.name}</span>
          <span className="cc-sub">{p.id}{p.version ? ' ' + p.version : ''} · {p.source === 'installed' ? 'installed' : 'bundled'}</span>
          {p.source === 'installed'
            ? <button className="pl-remove" disabled={busy} onClick={() => remove(p)}>Remove</button>
            : <span className="cc-sub pl-fixed" title="A folder in the plugins dir: add or delete the folder">folder</span>}
        </div>
      ))}
      {!plugins.length && <div className="cc-empty">No plugins</div>}
      {issued && (
        <div className="pl-token">
          <div>Token for <b>{issued.id}</b> (flies as <b>{issued.operator}</b>). Shown only now: put it in the plugin's config.</div>
          <code>{issued.token}</code>
          <button onClick={() => { navigator.clipboard?.writeText(issued.token).catch(() => {}); }}>Copy</button>
          <button onClick={() => setIssued(null)}>Done</button>
        </div>
      )}
      {open ? (
        <div className="pl-install">
          <div className="cc-hint">Paste the plugin's manifest (droneos-plugin.json). Same id again = update.</div>
          <textarea className="pl-manifest" value={text} onChange={e => setText(e.target.value)} rows={9} spellCheck={false} />
          <div className="pl-actions">
            <button className="pl-do-install" disabled={busy} onClick={install}>Install</button>
            <button disabled={busy} onClick={() => setOpen(false)}>Cancel</button>
          </div>
        </div>
      ) : <button className="pl-open" onClick={() => setOpen(true)}>Install a plugin…</button>}
    </div>
  );
};

export default PluginAdmin;
