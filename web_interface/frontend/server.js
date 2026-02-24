const express = require('express');
const { createProxyMiddleware } = require('http-proxy-middleware');
const path = require('path');

const app = express();

// Proxy API requests — use pathFilter (http-proxy-middleware v3)
// In Express 5 + HPM v3, app.use() strips the mount path before forwarding.
// Using app.use('/') with pathFilter preserves the full original URL.

app.use('/', createProxyMiddleware({
  target: 'http://127.0.0.1:3031',
  changeOrigin: true,
  pathFilter: '/api/openclaw',
}));

app.use('/', createProxyMiddleware({
  target: 'http://127.0.0.1:8081',
  changeOrigin: true,
  pathFilter: ['/api/incidents', '/api/dispatch'],
}));

app.use('/', createProxyMiddleware({
  target: 'http://127.0.0.1:8082',
  changeOrigin: true,
  pathFilter: '/api/bridge',
}));

// Serve static production build
app.use(express.static(path.join(__dirname, 'dist')));

// SPA fallback - MUST be last
app.get('/{*path}', (req, res) => {
  res.sendFile(path.join(__dirname, 'dist', 'index.html'));
});

app.listen(3000, '0.0.0.0', () => {
  console.log('DroneOS frontend serving on :3000 (production build)');
});
