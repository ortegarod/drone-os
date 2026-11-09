import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.resolve(__dirname, '..', 'out');
const port = Number(process.env.PORT || 3001);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

function resolveFile(urlPath) {
  const safePath = path.normalize(decodeURIComponent(urlPath)).replace(/^([/\\]|\.\.(\/|\\|$))+/, '');
  const full = path.join(outDir, safePath);
  if (!full.startsWith(outDir)) return null;
  if (fs.existsSync(full) && fs.statSync(full).isFile()) return full;
  if (fs.existsSync(full + '.html') && fs.statSync(full + '.html').isFile()) return full + '.html';
  const indexHtml = path.join(full, 'index.html');
  if (fs.existsSync(indexHtml) && fs.statSync(indexHtml).isFile()) return indexHtml;
  return null;
}

const server = http.createServer((req, res) => {
  const host = (req.headers.host || '').split(':')[0].toLowerCase();
  const parsed = new URL(req.url || '/', 'http://localhost');
  const pathname = parsed.pathname;

  if (host === 'www.droneos.dev') {
    res.writeHead(301, { Location: 'https://droneos.dev' + pathname + parsed.search });
    res.end();
    return;
  }

  if (host.startsWith('docs.')) {
    if (pathname === '/' || pathname === '/docs' || pathname === '/docs/') {
      res.writeHead(302, { Location: '/docs/getting-started/overview' });
      res.end();
      return;
    }
    if (
      !pathname.startsWith('/docs/') &&
      !pathname.startsWith('/_next/') &&
      !pathname.startsWith('/images/') &&
      pathname !== '/llms.txt' &&
      pathname !== '/sitemap.xml' &&
      pathname !== '/robots.txt' &&
      pathname !== '/icon.svg' &&
      pathname !== '/droneos-logo.svg' &&
      pathname !== '/favicon.ico'
    ) {
      const candidate = resolveFile('/docs' + pathname);
      if (candidate) {
        res.writeHead(301, { Location: '/docs' + pathname + parsed.search });
        res.end();
        return;
      }
    }
  } else if (pathname === '/docs' || pathname === '/docs/') {
    res.writeHead(302, { Location: '/docs/getting-started/overview' });
    res.end();
    return;
  }

  const file = resolveFile(pathname);
  if (!file) {
    const notFound = resolveFile('/404.html');
    res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(notFound ? fs.readFileSync(notFound) : 'Not Found');
    return;
  }

  const ext = path.extname(file).toLowerCase();
  res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});

server.listen(port, '0.0.0.0', () => {
  console.log(`droneos-docs listening on port ${port}`);
});
