import { spawn } from 'node:child_process';
import { request } from 'node:http';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { initializeNeonPersistence } from '../deploy/neon-persistence.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const dataDir = process.env.DIZA_DATA_DIR || `/tmp/diza-bot-${process.pid}`;
const innerPort = 18_000 + (process.pid % 1_000);
const innerOrigin = `http://127.0.0.1:${innerPort}`;
const faableAppId = 'app_6abb421e39d8bf107f77ddb9';
const supabaseProjectRef = 'wblxwdrlsicdgtcghfmk';

let core = null;
let persistence = null;
let bootPromise = null;

const wait = (ms) => new Promise((resolveWait) => setTimeout(resolveWait, ms));

async function syncDurably(reason) {
  let lastError = null;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await persistence.sync(reason);
    } catch (error) {
      lastError = error;
      if (attempt < 2) await wait(150 * (attempt + 1));
    }
  }
  throw lastError ?? new Error(`DIZA persistence sync failed: ${reason}`);
}

async function coreReady() {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      const response = await fetch(`${innerOrigin}/api/health`);
      if (response.ok) return;
    } catch {}
    if (core?.exitCode !== null) throw new Error(`DIZA core exited during startup (${core?.exitCode ?? 'unknown'})`);
    await wait(100);
  }
  throw new Error('DIZA core did not become ready');
}

async function boot() {
  if (core?.exitCode === null && persistence?.ready) return;
  await mkdir(dataDir, { recursive: true, mode: 0o700 });
  process.env.DIZA_DATA_DIR = dataDir;
  process.env.DIZA_PERSIST_GROK_HOME ||= `${dataDir}/provider-auth/grok`;
  process.env.DIZA_PERSIST_CODEX_HOME ||= `${dataDir}/provider-auth/codex`;
  const detectedPublicOrigin = process.env.VERCEL_PROJECT_PRODUCTION_URL
    ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
    : process.env.VERCEL_URL
      ? `https://${process.env.VERCEL_URL}`
      : undefined;
  if (!process.env.DIZA_PUBLIC_ORIGIN && detectedPublicOrigin) {
    process.env.DIZA_PUBLIC_ORIGIN = detectedPublicOrigin;
  }
  persistence = await initializeNeonPersistence();
  if (!persistence.enabled || !persistence.ready) {
    throw new Error(`DIZA persistence unavailable: ${persistence.reason || 'not ready'}`);
  }
  const env = {
    ...process.env,
    DIZA_DATA_DIR: dataDir,
    DIZA_SERVERLESS: '1',
    BLOKS_PORT: String(innerPort),
    BLOKS_BIND_HOST: '127.0.0.1',
    BLOKS_LOOPBACK_ONLY: '1',
  };
  core = spawn(process.execPath, ['--experimental-strip-types', resolve(root, 'server/index.ts')], {
    cwd: root,
    env,
    stdio: 'inherit',
  });
  core.once('exit', () => { core = null; });
  await coreReady();
  // A fresh database is seeded by the unchanged core. Commit that seed
  // before the first browser request can race a cold sibling instance.
  await syncDurably('vercel-bootstrap');
}

function ensureBooted() {
  if (!bootPromise) {
    bootPromise = boot().catch((error) => {
      bootPromise = null;
      throw error;
    });
  }
  return bootPromise;
}

function upstreamPath(req) {
  const incoming = new URL(req.url || '/', 'http://vercel.local');
  const routed = incoming.searchParams.get('__diza_path');
  incoming.searchParams.delete('__diza_path');
  const pathname = routed === null ? incoming.pathname : `/api/${routed.replace(/^\/+/, '')}`;
  const query = incoming.searchParams.toString();
  return `${pathname}${query ? `?${query}` : ''}`;
}

function hasAllowedPublicOrigin(req) {
  const origin = req.headers.origin;
  if (!origin || origin === 'null') return true;
  try {
    const forwardedHost = String(req.headers['x-forwarded-host'] || req.headers.host || '')
      .split(',')[0]
      .trim();
    return new URL(origin).host === forwardedHost;
  } catch {
    return false;
  }
}

function proxy(req, res, path) {
  return new Promise((resolveProxy, rejectProxy) => {
    const headers = { ...req.headers, host: `127.0.0.1:${innerPort}` };
    // The public request has already passed the Vercel-host origin check.
    // Do not forward its public Origin to the loopback-only core.
    delete headers.origin;
    delete headers['x-vercel-id'];
    delete headers['x-vercel-forwarded-for'];
    const upstream = request({
      hostname: '127.0.0.1',
      port: innerPort,
      method: req.method,
      path,
      headers,
    }, (incoming) => {
      const responseHeaders = { ...incoming.headers };
      delete responseHeaders.connection;
      delete responseHeaders['transfer-encoding'];
      responseHeaders['cache-control'] = 'no-store';
      res.writeHead(incoming.statusCode || 502, responseHeaders);
      incoming.on('data', (chunk) => res.write(chunk));
      incoming.on('end', resolveProxy);
      incoming.on('error', rejectProxy);
    });
    upstream.on('error', rejectProxy);
    req.on('aborted', () => upstream.destroy());
    req.pipe(upstream);
  });
}

export default async function handler(req, res) {
  try {
    if (!hasAllowedPublicOrigin(req)) {
      res.writeHead(403, { 'content-type': 'application/json', 'cache-control': 'no-store' });
      res.end(JSON.stringify({ error: 'cross-origin requests are not allowed' }));
      return;
    }
    const path = upstreamPath(req);
    const bootstrapRequest =
      req.method === 'POST' &&
      (path.includes('faable-supabase-bootstrap') || String(req.url || '').includes('faable-supabase-bootstrap'));
    if (bootstrapRequest) {
      const authorization = String(req.headers.authorization || '');
      if (!authorization.startsWith('Bearer ')) {
        res.writeHead(401, { 'content-type': 'application/json', 'cache-control': 'no-store' });
        res.end(JSON.stringify({ error: 'missing Faable authorization' }));
        return;
      }
      const appCheck = await fetch(`https://api.faable.com/app/${faableAppId}`, {
        headers: { authorization },
      });
      if (!appCheck.ok) {
        res.writeHead(403, { 'content-type': 'application/json', 'cache-control': 'no-store' });
        res.end(JSON.stringify({ error: 'Faable authorization rejected' }));
        return;
      }
      const databaseUrl = process.env.DATABASE_URL || '';
      let parsed;
      try { parsed = new URL(databaseUrl); } catch {}
      const supabaseIdentity = `${parsed?.username || ''}@${parsed?.hostname || ''}`;
      if (!parsed || !['postgres:', 'postgresql:'].includes(parsed.protocol) || !supabaseIdentity.includes(supabaseProjectRef)) {
        res.writeHead(503, { 'content-type': 'application/json', 'cache-control': 'no-store' });
        res.end(JSON.stringify({ error: 'Supabase database URL is unavailable' }));
        return;
      }
      res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' });
      res.end(databaseUrl);
      return;
    }
    await ensureBooted();
    await proxy(req, res, path);
    const oauthCallback = /^\/api\/oauth\/[\w-]+\/callback(?:\?|$)/.test(path);
    if (oauthCallback || (req.method && !['GET', 'HEAD', 'OPTIONS'].includes(req.method))) {
      await syncDurably(`vercel-${req.method.toLowerCase()}`);
    }
    res.end();
  } catch (error) {
    console.error(`[diza-vercel] ${error?.stack || error}`);
    if (!res.headersSent) {
      res.writeHead(503, { 'content-type': 'application/json', 'cache-control': 'no-store' });
      res.end(JSON.stringify({ error: 'DIZA is temporarily unavailable; saved data was not replaced.' }));
    } else {
      res.end();
    }
  }
}
