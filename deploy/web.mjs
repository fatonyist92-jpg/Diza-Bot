// Hosting adapter only. The DIZA core keeps its original loopback boundary.
import { createServer, request } from 'node:http';
import { createHash, timingSafeEqual } from 'node:crypto';
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const port = Number(process.env.PORT || 10000);
const innerPort = Number(process.env.BLOKS_PORT || 8799);
const username = process.env.DIZA_WEB_USERNAME || 'diza';
const password = process.env.DIZA_WEB_PASSWORD;
if (!password || password.length < 24) throw new Error('Set DIZA_WEB_PASSWORD to a random secret of at least 24 characters.');
if (port === innerPort) throw new Error('PORT and BLOKS_PORT must be different.');
const origin = new URL(process.env.DIZA_PUBLIC_ORIGIN || process.env.RENDER_EXTERNAL_URL || `http://127.0.0.1:${port}`);
if (origin.protocol !== 'https:' && !['127.0.0.1', 'localhost', '[::1]'].includes(origin.hostname)) {
  throw new Error('The public origin must use HTTPS.');
}
const digest = (value) => createHash('sha256').update(value).digest();
const expected = digest(`${username}:${password}`);
const env = { ...process.env, BLOKS_PORT: String(innerPort), BLOKS_STATIC_DIR: resolve(root, 'dist'), BLOKS_LOOPBACK_ONLY: '1' };
delete env.DIZA_WEB_PASSWORD;
const core = spawn(process.execPath, ['--experimental-strip-types', 'server/index.ts'], { cwd: root, env, stdio: 'inherit' });
let closing = false;

const gateway = createServer((req, res) => {
  const url = new URL(req.url || '/', origin);
  const health = req.method === 'GET' && url.pathname === '/healthz';
  const publicAsset = req.method === 'GET' && ['/manifest.webmanifest', '/app-icon.svg'].includes(url.pathname);
  const suppliedOrigin = req.headers.origin;
  if (req.headers.host !== origin.host || (suppliedOrigin && suppliedOrigin !== origin.origin) || req.headers['sec-fetch-site'] === 'cross-site') {
    res.writeHead(403, { 'content-type': 'application/json', 'cache-control': 'no-store' });
    return res.end('{"error":"Request origin is not allowed"}');
  }
  if (!health && !publicAsset) {
    const auth = req.headers.authorization || '';
    const decoded = /^Basic /i.test(auth) ? Buffer.from(auth.slice(6), 'base64').toString('utf8') : '';
    if (!timingSafeEqual(digest(decoded), expected)) {
      res.writeHead(401, { 'www-authenticate': 'Basic realm="DIZA BOT", charset="UTF-8"', 'cache-control': 'no-store', 'content-type': 'text/plain; charset=utf-8' });
      return res.end('Masuk dengan akun akses DIZA BOT.');
    }
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
function stop(code = 0) {
  if (closing) return;
  closing = true;
  gateway.close();
  gateway.closeAllConnections();
  core.kill('SIGTERM');
  setTimeout(() => process.exit(code), 3000).unref();
}
core.on('error', () => stop(1));
core.on('exit', (code) => stop(code || 0));
for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => stop());
