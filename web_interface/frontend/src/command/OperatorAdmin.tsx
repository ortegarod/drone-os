// Dev tab (admins): who has access. Accounts are managed here; the tokens file and plugins
// are listed read-only. A new account's token (or a reset one) is shown once.
import React, { useCallback, useEffect, useState } from 'react';
import { api } from '../api/fleet';

interface Op { name: string; role: string; source: 'account' | 'file' | 'plugin'; created?: string; by?: string; plugin?: string }
const ROLES = ['admin', 'pilot', 'viewer'];

const OperatorAdmin: React.FC<{ me: string; note: (text: string, ok: boolean) => void }> = ({ me, note }) => {
  const [ops, setOps] = useState<Op[]>([]);
  const [name, setName] = useState('');
  const [role, setRole] = useState('pilot');
  const [issued, setIssued] = useState<{ name: string; token: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => { api<Op[]>('GET', '/operators').then(setOps).catch(() => {}); }, []);
  useEffect(load, [load]);

  const act = async (fn: () => Promise<void>) => {
    setBusy(true);
    try { await fn(); } catch (e) { note((e as Error).message, false); }
    setBusy(false);
    load();
  };
  const add = () => act(async () => {
    const r = await api<{ name: string; token: string }>('POST', '/operators', { name: name.trim(), role });
    setIssued({ name: r.name, token: r.token }); setName(''); note(`Added ${r.name} (${role})`, true);
  });
  const setOpRole = (o: Op, r: string) => act(async () => { await api('PATCH', '/operators/' + o.name, { role: r }); note(`${o.name} is now ${r}`, true); });
  const reset = (o: Op) => act(async () => {
    if (!window.confirm(`New token for ${o.name}? The current one stops working now.`)) return;
    const r = await api<{ token: string }>('POST', `/operators/${o.name}/token`); setIssued({ name: o.name, token: r.token });
  });
  const remove = (o: Op) => act(async () => {
    if (!window.confirm(`Remove ${o.name}? Their token stops working and they lose any drone they control.`)) return;
    await api('DELETE', '/operators/' + o.name); note(`Removed ${o.name}`, true);
    if (issued?.name === o.name) setIssued(null);
  });

  return (
    <div className="mn-block op-admin">
      <div className="mn-title">Operators <span className="cc-sub">admin: everything · pilot: fly · viewer: watch only</span></div>
      {ops.map(o => (
        <div key={o.source + o.name} className="pl-row" data-operator={o.name}>
          <span className="pl-name">{o.name}</span>
          {o.source === 'account' && o.name !== me
            ? <select className="op-role" value={o.role} disabled={busy} onChange={e => setOpRole(o, e.target.value)}>
                {ROLES.map(r => <option key={r} value={r}>{r}</option>)}
              </select>
            : <span className="cc-sub">{o.role}</span>}
          <span className="cc-sub">{o.source === 'account' ? `added by ${o.by}` : o.source === 'plugin' ? `plugin ${o.plugin}` : 'tokens file'}</span>
          {o.source === 'account' && <button className="op-token" disabled={busy} onClick={() => reset(o)}>New token</button>}
          {o.source === 'account' && o.name !== me && <button className="op-remove" disabled={busy} onClick={() => remove(o)}>Remove</button>}
        </div>
      ))}
      {issued && (
        <div className="pl-token">
          <div>Token for <b>{issued.name}</b>. Shown only now: send it to them privately. They paste it at the login screen
            (or into ~/.config/droneos/client.json for the CLI).</div>
          <code>{issued.token}</code>
          <button onClick={() => setIssued(null)}>Done</button>
        </div>
      )}
      <div className="op-add">
        <input className="op-name" placeholder="name" value={name} onChange={e => setName(e.target.value.toLowerCase())} />
        <select className="op-newrole" value={role} onChange={e => setRole(e.target.value)}>{ROLES.map(r => <option key={r} value={r}>{r}</option>)}</select>
        <button className="op-do-add" disabled={busy || name.trim().length < 2} onClick={add}>Add operator</button>
      </div>
    </div>
  );
};

export default OperatorAdmin;
