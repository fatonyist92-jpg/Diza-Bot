// Hosting adapter only. The DIZA core keeps its original loopback boundary.
import { createServer, request } from 'node:http';
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { initializeNeonPersistence } from './neon-persistence.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const port = Number(process.env.PORT || 10000);
const innerPort = Number(process.env.BLOKS_PORT || 8799);
if (port === innerPort) throw new Error('PORT and BLOKS_PORT must be different.');
const faableOrigin = process.env.FAABLE_HOST
  ? (/^https?:\/\//i.test(process.env.FAABLE_HOST) ? process.env.FAABLE_HOST : `https://${process.env.FAABLE_HOST}`)
  : undefined;
const origin = new URL(process.env.DIZA_PUBLIC_ORIGIN || process.env.RENDER_EXTERNAL_URL || faableOrigin || `http://127.0.0.1:${port}`);
if (origin.protocol !== 'https:' && !['127.0.0.1', 'localhost', '[::1]'].includes(origin.hostname)) {
  throw new Error('The public origin must use HTTPS.');
}
const env = { ...process.env, BLOKS_PORT: String(innerPort), BLOKS_STATIC_DIR: resolve(root, 'dist'), BLOKS_LOOPBACK_ONLY: '1' };
delete env.DIZA_WEB_PASSWORD;

// Restore DIZA state before the core reads ~/.bloks or provider auth homes.
// Failure is fail-safe for the live app: the core still starts, but persistence
// stays disabled for this process rather than risking an empty-runtime overwrite.
const persistence = await initializeNeonPersistence();
const core = spawn(process.execPath, ['--experimental-strip-types', 'server/index.ts'], { cwd: root, env, stdio: 'inherit' });
persistence.start();
let closing = false;

const gateway = createServer((req, res) => {
  const url = new URL(req.url || '/', origin);
  const health = req.method === 'GET' && url.pathname === '/healthz';
  const suppliedOrigin = req.headers.origin;
  const requestHost = req.headers.host;
  const sameRequestOrigin = (() => {
    if (!suppliedOrigin || !requestHost) return !suppliedOrigin;
    try {
      const candidate = new URL(suppliedOrigin);
      return candidate.host === requestHost && candidate.protocol === origin.protocol;
    } catch {
      return false;
    }
  })();
  const crossSite = req.headers['sec-fetch-site'] === 'cross-site';
  const topLevelGetNavigation =
    req.method === 'GET' &&
    req.headers['sec-fetch-mode'] === 'navigate';

  if (
    (suppliedOrigin && suppliedOrigin !== origin.origin && !sameRequestOrigin) ||
    (crossSite && !topLevelGetNavigation)
  ) {
    res.writeHead(403, { 'content-type': 'application/json', 'cache-control': 'no-store' });
    return res.end('{"error":"Request origin is not allowed"}');
  }
  const headers = { ...req.headers, host: `127.0.0.1:${innerPort}` };
  delete headers.authorization;
  delete headers.cookie;
  delete headers.forwarded;
  for (const key of Object.keys(headers)) if (key.startsWith('x-forwarded-')) delete headers[key];
  if (suppliedOrigin) headers.origin = `http://127.0.0.1:${innerPort}`;
  const upstream = request({ hostname: '127.0.0.1', port: innerPort, path: health ? '/api/health' : req.url, method: req.method, headers }, (incoming) => {
    if (health) {
      incoming.resume();
      res.writeHead(incoming.statusCode === 200 ? 200 : 503, { 'content-type': 'application/json', 'cache-control': 'no-store' });
      return res.end(JSON.stringify({ ok: incoming.statusCode === 200 }));
    }
    const responseHeaders = { ...incoming.headers };
    if (url.pathname.startsWith('/api/') || url.pathname === '/sw.js') responseHeaders['cache-control'] = 'no-store';
    res.writeHead(incoming.statusCode || 502, responseHeaders);
    incoming.pipe(res);
    incoming.on('error', () => res.destroy());
  });
  upstream.on('error', () => {
    if (res.headersSent) return res.destroy();
    res.writeHead(503, { 'content-type': 'application/json', 'cache-control': 'no-store' });
    res.end('{"error":"DIZA backend is starting or unavailable"}');
  });
  req.on('aborted', () => upstream.destroy());
  res.on('close', () => upstream.destroy());
  req.pipe(upstream);
});

gateway.listen(port, '0.0.0.0', () => console.log(`[diza-web] listening on port ${port}`));
async function stop(code = 0) {
  if (closing) return;
  closing = true;
  gateway.close();
  gateway.closeAllConnections();
  core.kill('SIGTERM');
  const forceExit = setTimeout(() => process.exit(code), 3000);
  forceExit.unref?.();
  try {
    await persistence.close();
  } finally {
    clearTimeout(forceExit);
    process.exit(code);
  }
}
core.on('error', () => void stop(1));
core.on('exit', (code) => void stop(code || 0));
for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => void stop());
