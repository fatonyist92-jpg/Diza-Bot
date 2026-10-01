// Hosting adapter only. The DIZA core keeps its original loopback boundary.
import { createServer, request } from 'node:http';
import { spawn } from 'node:child_process';
import { generateKeyPairSync, privateDecrypt } from 'node:crypto';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { initializeNeonPersistence } from './neon-persistence.mjs';
import { initializeObjectPersistence, recoverObjectPersistenceWithRawKey } from './object-persistence.mjs';

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
// On an ephemeral hosted runtime a configured database is authoritative:
// if it cannot be restored, starting an empty core is destructive-looking
// and may later overwrite good state. Fail closed instead.
let persistence = await initializeObjectPersistence();
if (!persistence.enabled || !persistence.ready) {
  const postgresPersistence = await initializeNeonPersistence();
  if (postgresPersistence.enabled && postgresPersistence.ready) persistence = postgresPersistence;
}
const persistenceRequired = true;
const persistenceHealthy = persistence.enabled && persistence.ready;
let core = null;
let recoveryKeys = null;
let recoveryInFlight = false;
let closing = false;

function wireCore(child) {
  child.on('error', () => void stop(1));
  child.on('exit', (code) => void stop(code || 0));
}

function startCore() {
  if (core) return core;
  core = spawn(process.execPath, ['--experimental-strip-types', 'server/index.ts'], { cwd: root, env, stdio: 'inherit' });
  wireCore(core);
  persistence.start();
  recoveryKeys = null;
  console.log('[diza-web] DIZA core started with durable persistence');
  return core;
}

if (persistenceHealthy) {
  startCore();
} else {
  recoveryKeys = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
  console.error(`[diza-web] core held offline: persistence ${persistence.reason || 'not ready'}`);
  console.warn('[diza-web] one-time encrypted recovery bridge enabled while core is offline');
}

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

  // One-time recovery bridge. It exists only while the core is held
  // offline. The public half is safe to expose; the private key never
  // leaves this process. The recovery payload is only a 32-byte bootstrap
  // key wrapped with RSA-OAEP, so no storage/database credential appears
  // in a URL, response or repository.
  if (!core && recoveryKeys && req.method === 'GET' && url.pathname === '/__diza/recovery-key') {
    res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
    return res.end(JSON.stringify({ publicKey: recoveryKeys.publicKey, algorithm: 'RSA-OAEP-SHA256' }));
  }

  if (!core && recoveryKeys && req.method === 'GET' && url.pathname === '/__diza/recover') {
    const wrapped = url.searchParams.get('key') || '';
    if (!wrapped || wrapped.length > 1024 || recoveryInFlight) {
      res.writeHead(recoveryInFlight ? 409 : 400, { 'content-type': 'application/json', 'cache-control': 'no-store' });
      return res.end(JSON.stringify({ error: recoveryInFlight ? 'recovery already running' : 'invalid recovery envelope' }));
    }
    recoveryInFlight = true;
    void (async () => {
      try {
        const rawKey = privateDecrypt(
          { key: recoveryKeys.privateKey, oaepHash: 'sha256' },
          Buffer.from(wrapped, 'base64url'),
        );
        if (rawKey.length !== 32) throw new Error('invalid recovery key length');
        const recovered = await recoverObjectPersistenceWithRawKey(rawKey);
        await persistence.close().catch(() => {});
        persistence = recovered;
        startCore();
        res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
        res.end(JSON.stringify({ ok: true, persistence: 'object-storage', core: 'started' }));
      } catch (error) {
        recoveryInFlight = false;
        console.error(`[diza-web] encrypted recovery failed: ${error?.message || error}`);
        res.writeHead(400, { 'content-type': 'application/json', 'cache-control': 'no-store' });
        res.end(JSON.stringify({ error: 'encrypted recovery failed' }));
      }
    })();
    return;
  }

  if (health && !core) {
    res.writeHead(503, { 'content-type': 'application/json', 'cache-control': 'no-store' });
    return res.end(JSON.stringify({
      ok: false,
      persistence: {
        enabled: Boolean(persistence.enabled),
        ready: Boolean(persistence.ready),
        ...(persistence.reason ? { reason: persistence.reason } : {}),
      },
    }));
  }

  if (!core && !health) {
    res.writeHead(503, { 'content-type': 'application/json', 'cache-control': 'no-store' });
    return res.end(JSON.stringify({
      error: 'DIZA persistence is unavailable. The core was not started so your saved workspace cannot be replaced by an empty one.',
    }));
  }

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
      const ok = incoming.statusCode === 200;
      return res.end(JSON.stringify({
        ok,
        persistence: {
          enabled: Boolean(persistence.enabled),
          ready: Boolean(persistence.ready),
          ...(persistence.reason ? { reason: persistence.reason } : {}),
        },
      }));
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
  core?.kill('SIGTERM');
  const forceExit = setTimeout(() => process.exit(code), 3000);
  forceExit.unref?.();
  try {
    await persistence.close();
  } finally {
    clearTimeout(forceExit);
    process.exit(code);
  }
}
for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => void stop());
