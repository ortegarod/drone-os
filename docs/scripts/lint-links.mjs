import fs from 'node:fs/promises';
import path from 'node:path';
import GithubSlugger from 'github-slugger';

const docsRoot = path.resolve('content/docs');
const exts = new Set(['.md', '.mdx']);

const files = await collectDocs(docsRoot);
const pages = new Map();

for (const file of files) {
  const rel = path.relative(docsRoot, file).replace(/\\/g, '/');
  const url = fileToUrl(rel);
  pages.set(url, {
    file,
    rel,
    url,
    anchors: await extractAnchors(file),
  });
}

const errors = [];

for (const page of pages.values()) {
  const content = await fs.readFile(page.file, 'utf8');
  for (const ref of extractLinks(content)) {
    const resolved = resolveDocLink(ref.target, page.url);
    if (!resolved) continue;

    const targetPage = pages.get(resolved.pathname);
    if (!targetPage) {
      errors.push(`${page.rel}: broken link ${ref.target} -> ${resolved.pathname}`);
      continue;
    }

    if (resolved.hash && !targetPage.anchors.has(resolved.hash)) {
      errors.push(`${page.rel}: missing heading ${ref.target} -> ${resolved.pathname}#${resolved.hash}`);
    }
  }
}

if (errors.length > 0) {
  console.error('\nBroken docs links found:\n');
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

console.log(`Validated ${pages.size} docs pages, no broken internal docs links found.`);

async function collectDocs(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const out = [];

  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...await collectDocs(full));
      continue;
    }

    if (exts.has(path.extname(entry.name))) {
      out.push(full);
    }
  }

  return out;
}

function fileToUrl(rel) {
  const noExt = rel.replace(/\.(md|mdx)$/i, '');
  const parts = noExt.split('/').filter(Boolean);
  if (parts.at(-1) === 'index') parts.pop();
  return `/docs/${parts.join('/')}`.replace(/\/$/, '') || '/docs';
}

async function extractAnchors(file) {
  const content = await fs.readFile(file, 'utf8');
  const lines = content.split(/\r?\n/);
  const slugger = new GithubSlugger();
  const anchors = new Set();

  for (const line of lines) {
    const match = line.match(/^(#{1,6})\s+(.+?)\s*$/);
    if (!match) continue;

    let text = match[2].trim();
    const explicit = text.match(/\[#([^\]]+)\]\s*$/);
    if (explicit) {
      anchors.add(explicit[1]);
      text = text.replace(/\s*\[(?:#|!toc|toc)[^\]]*\]\s*$/g, '').trim();
    }

    text = text.replace(/\s*\[(?:#|!toc|toc)[^\]]*\]\s*$/g, '').trim();
    text = text.replace(/`([^`]+)`/g, '$1');
    if (text.length > 0) anchors.add(slugger.slug(text));
  }

  return anchors;
}

function extractLinks(content) {
  const links = [];
  const markdown = /\[[^\]]+\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;
  const jsx = /href\s*=\s*["']([^"']+)["']/g;

  for (const match of content.matchAll(markdown)) links.push({ target: match[1] });
  for (const match of content.matchAll(jsx)) links.push({ target: match[1] });

  return links;
}

function resolveDocLink(target, currentUrl) {
  if (!target) return null;
  if (target.startsWith('http://') || target.startsWith('https://') || target.startsWith('mailto:') || target.startsWith('tel:')) return null;
  if (target.startsWith('#')) return { pathname: currentUrl, hash: target.slice(1) };

  const url = new URL(target, `https://docs.local${currentUrl.endsWith('/') ? currentUrl : `${currentUrl}/`}`);
  if (!url.pathname.startsWith('/docs')) return null;

  const pathname = normalizeDocsPath(url.pathname);
  const hash = url.hash ? url.hash.slice(1) : '';
  return { pathname, hash };
}

function normalizeDocsPath(pathname) {
  let normalized = pathname.replace(/\/$/, '');
  normalized = normalized.replace(/\.(md|mdx)$/i, '');
  return normalized || '/docs';
}
