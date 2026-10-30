const express = require('express');
const { createProxyMiddleware } = require('http-proxy-middleware');
const path = require('path');

const app = express();

// Auto-login (dev, Tailscale only): hand the browser the key of AUTO_LOGIN_OPERATOR,
// so there's no key screen. The API still knows who sent each command.
const fs = require('fs');
app.get('/api/auto-login', (req, res) => {
  const name = process.env.AUTO_LOGIN_OPERATOR;
  const file = process.env.FLEET_API_TOKENS;
  if (!name || !file) return res.status(404).json({ detail: 'auto-login off' });
  try {
    const tokens = JSON.parse(fs.readFileSync(file, 'utf8'));
    const key = Object.keys(tokens).find(k => tokens[k] === name);
    if (!key) return res.status(404).json({ detail: 'no key for ' + name });
    res.set('Cache-Control', 'no-store').json({ key });
  } catch (err) {
    res.status(500).json({ detail: String(err) });
  }
});

// Proxy API requests — use pathFilter (http-proxy-middleware v3)
// In Express 5 + HPM v3, app.use() strips the mount path before forwarding.
// Using app.use('/') with pathFilter preserves the full original URL.

// Fleet API: all drone state and commands (HTTP + the telemetry WebSocket)
const fleetApi = createProxyMiddleware({
  target: 'http://127.0.0.1:8090',
  changeOrigin: true,
  pathFilter: '/api/v1',
  ws: true,
});
app.use('/', fleetApi);


// Dispatch and other plugins are reached through the fleet API (/api/v1/plugins/<id>/...).

// Camera streams (MJPEG) from the camera proxy, so the browser only needs this port
app.use('/', createProxyMiddleware({
  target: 'http://127.0.0.1:8080',
  changeOrigin: true,
  pathFilter: '/camera',
  pathRewrite: { '^/camera': '' },
}));

// Serve static production build
app.use(express.static(path.join(__dirname, 'dist')));

// SPA fallback - MUST be last
app.get('/{*path}', (req, res) => {
  res.sendFile(path.join(__dirname, 'dist', 'index.html'));
});

const server = app.listen(3000, '0.0.0.0', () => {
  console.log('DroneOS frontend serving on :3000 (production build)');
});
server.on('upgrade', fleetApi.upgrade);
