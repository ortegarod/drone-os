const express = require('express');
const { createProxyMiddleware } = require('http-proxy-middleware');
const path = require('path');

const app = express();

// Proxy API requests to openclaw_proxy (v2 syntax)
app.use('/api/openclaw', createProxyMiddleware({
  target: 'http://127.0.0.1:3031',
  changeOrigin: true,
  pathRewrite: {
    '^/api/openclaw': '/api/openclaw', // Keep the path
  },
}));

// Serve static production build
app.use(express.static(path.join(__dirname, 'dist')));

// SPA fallback - MUST be last
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'dist', 'index.html'));
});

app.listen(3000, '0.0.0.0', () => {
  console.log('DroneOS frontend serving on :3000 (production build)');
});
