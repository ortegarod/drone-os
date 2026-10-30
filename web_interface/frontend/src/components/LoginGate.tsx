import React, { createContext, useContext, useEffect, useState } from 'react';
import { hasKey, login, logout, onAuthChange, startTelemetry, api } from '../api/fleet';

const OperatorContext = createContext('');
const RoleContext = createContext('');
/** Name of the logged-in operator. */
export const useOperator = () => useContext(OperatorContext);
/** Their role: admin, pilot or viewer. */
export const useRole = () => useContext(RoleContext);

/** Shows a login form until the operator has a valid fleet API key, then renders the app. */
const LoginGate: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [operator, setOperator] = useState<string | null>(null);
  const [role, setRole] = useState('');
  useEffect(() => {
    if (operator) api<{ role?: string }>('GET', '/me').then(r => setRole(r.role || '')).catch(() => setRole(''));
    else setRole('');
  }, [operator]);
  const [checking, setChecking] = useState(true);
  const [key, setKey] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    const off = onAuthChange(ok => { if (!ok) setOperator(null); });
    if (hasKey()) {
      api<{ operator: string }>('GET', '/me')
        .then(r => { setOperator(r.operator); startTelemetry(); })
        .catch(() => setOperator(null))
        .finally(() => setChecking(false));
    } else {
      // No key yet: the server may log us in by itself (dev setup on Tailscale).
      fetch('/api/auto-login')
        .then(r => (r.ok ? r.json() : Promise.reject()))
        .then(d => login(d.key))
        .then(name => { setOperator(name); startTelemetry(); })
        .catch(() => setOperator(null))
        .finally(() => setChecking(false));
    }
    return off;
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    try {
      setOperator(await login(key.trim()));
      setKey('');
      startTelemetry();
    } catch (err: any) {
      setError(err?.message || 'Login failed');
    }
  };

  if (checking) return <div className="login-screen"><div className="login-box">Connecting…</div></div>;

  if (!operator) {
    return (
      <div className="login-screen">
        <form className="login-box" onSubmit={submit}>
          <div className="login-title">DRONEOS COMMAND CENTER</div>
          <label htmlFor="operator-key">Operator key</label>
          <input id="operator-key" type="password" autoComplete="current-password" value={key}
                 onChange={e => setKey(e.target.value)} autoFocus />
          <button type="submit" disabled={!key.trim()}>Log in</button>
          {error && <div className="login-error">{error}</div>}
        </form>
      </div>
    );
  }

  return (
    <OperatorContext.Provider value={operator}>
      <RoleContext.Provider value={role}>
        <div className="operator-badge" title={role === 'viewer' ? 'Viewer: you can watch, not fly' : 'Logged in operator'}>
          {operator}{role ? <span className={`role role-${role}`}>{role}</span> : null} <button onClick={logout}>log out</button>
        </div>
        {children}
      </RoleContext.Provider>
    </OperatorContext.Provider>
  );
};

export default LoginGate;
