import { createDecipheriv, createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { chmod, mkdir, readdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join, posix, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync, gunzipSync } from 'node:zlib';

const SNAPSHOT_VERSION = 1;
const DEFAULT_INTERVAL_MS = 30_000;
const MAX_FILE_BYTES = 4 * 1024 * 1024;
const MAX_TOTAL_BYTES = 32 * 1024 * 1024;
const BOOTSTRAP_FILE = fileURLToPath(new URL('./diza-storage-bootstrap.enc.json', import.meta.url));

const safeMode = (value) => {
  const parsed = Number(value);
  return Number.isInteger(parsed) ? (parsed & 0o777) : 0o600;
};

function safeRelativePath(value) {
  if (typeof value !== 'string' || !value || value.includes('\0')) return null;
  const slash = value.replaceAll('\\', '/');
  if (slash.startsWith('/') || /^[A-Za-z]:/.test(slash)) return null;
  const normalized = posix.normalize(slash);
  if (!normalized || normalized === '.' || normalized === '..' || normalized.startsWith('../')) return null;
  if (normalized.split('/').some((part) => !part || part === '..')) return null;
  return normalized;
}

function targetFor(rootDir, relativePath) {
  const safe = safeRelativePath(relativePath);
  if (!safe) return null;
  const base = resolve(rootDir);
  const target = resolve(base, ...safe.split('/'));
  if (target !== base && !target.startsWith(`${base}${sep}`)) return null;
  return target;
}

async function atomicWrite(target, data, mode = 0o600) {
  await mkdir(dirname(target), { recursive: true, mode: 0o700 });
  const temp = `${target}.diza-object-restore-${process.pid}`;
  await writeFile(temp, data, { mode });
  await chmod(temp, mode).catch(() => {});
  await rename(temp, target);
  await chmod(target, mode).catch(() => {});
}

function decryptBootstrap(databaseUrl) {
  if (!databaseUrl) throw new Error('DATABASE_URL is required to unlock the storage bootstrap');
  const envelope = JSON.parse(requireText(BOOTSTRAP_FILE));
  if (envelope.version !== 2 || envelope.aad !== 'diza-storage-bootstrap-v2') {
    throw new Error('unsupported DIZA storage bootstrap');
  }
  let password;
  try {
    password = decodeURIComponent(new URL(databaseUrl).password);
  } catch {
    throw new Error('DATABASE_URL is not a valid URL');
  }
  if (!password) throw new Error('DATABASE_URL has no password credential');
  // Faable may rewrite the Neon hostname/pooler/query string while keeping
  // the same database credential. The password is the stable secret shared
  // by both representations; host text is not key material.
  const key = createHash('sha256').update(`DIZA_STORAGE_V2\0${password}`).digest();
  const iv = Buffer.from(envelope.iv, 'base64');
  const tag = Buffer.from(envelope.tag, 'base64');
  const encrypted = Buffer.from(envelope.data, 'base64');
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAAD(Buffer.from(envelope.aad));
  decipher.setAuthTag(tag);
  const plain = Buffer.concat([decipher.update(encrypted), decipher.final()]);
  return JSON.parse(gunzipSync(plain).toString('utf8'));
}

function requireText(path) {
  const require = createRequire(import.meta.url);
  return require('node:fs').readFileSync(path, 'utf8');
}

function roots() {
  const dataDir = process.env.DIZA_DATA_DIR || join(homedir(), '.bloks');
  return [
    {
      namespace: 'bloks',
      dir: dataDir,
      include: (path) =>
        !(
          path === 'native' || path.startsWith('native/') ||
          path === 'events' || path.startsWith('events/') ||
          path === 'artifacts' || path.startsWith('artifacts/') ||
          path === 'attachments' || path.startsWith('attachments/')
        ),
    },
    {
      namespace: 'grok',
      dir: process.env.GROK_HOME || join(homedir(), '.grok'),
      include: (path) => path === 'auth.json',
    },
    {
      namespace: 'codex',
      dir: process.env.CODEX_HOME || join(homedir(), '.codex'),
      include: (path) => ['auth.json', 'config.toml', 'environments.toml'].includes(path),
    },
  ];
}

async function collectRoot(root) {
  const found = [];
  const base = resolve(root.dir);
  async function walk(dir, prefix = '') {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch (error) {
      if (error?.code === 'ENOENT') return;
      throw error;
    }
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (rel.includes('.diza-object-restore-')) continue;
      const full = resolve(dir, entry.name);
      if (full !== base && !full.startsWith(`${base}${sep}`)) continue;
      if (entry.isDirectory()) {
        if (root.include(rel) || root.namespace === 'bloks') await walk(full, rel);
        continue;
      }
      if (!entry.isFile() || !root.include(rel)) continue;
      let info;
      try { info = await stat(full); } catch { continue; }
      if (info.size > MAX_FILE_BYTES) continue;
      found.push({ path: rel, full, mode: info.mode & 0o777, size: info.size });
    }
  }
  await walk(base);
  return found;
}

async function buildManifest() {
  const files = [];
  let total = 0;
  for (const root of roots()) {
    for (const file of await collectRoot(root)) {
      if (total + file.size > MAX_TOTAL_BYTES) continue;
      const data = await readFile(file.full).catch(() => null);
      if (!data) continue;
      total += data.length;
      files.push({
        namespace: root.namespace,
        path: file.path,
        mode: file.mode || 0o600,
        data: data.toString('base64'),
      });
    }
  }
  return { version: SNAPSHOT_VERSION, savedAt: new Date().toISOString(), files };
}

function rootByNamespace(namespace) {
  return roots().find((root) => root.namespace === namespace) ?? null;
}

async function restoreManifest(manifest) {
  if (!manifest || manifest.version !== SNAPSHOT_VERSION || !Array.isArray(manifest.files)) {
    throw new Error('invalid object-storage snapshot');
  }
  let restored = 0;
  for (const file of manifest.files) {
    const root = rootByNamespace(file?.namespace);
    if (!root || !root.include(file.path)) continue;
    const target = targetFor(root.dir, file.path);
    if (!target) continue;
    const data = Buffer.from(String(file.data || ''), 'base64');
    if (data.length > MAX_FILE_BYTES) continue;
    await atomicWrite(target, data, safeMode(file.mode));
    restored += 1;
  }
  return restored;
}

async function applyBootstrapFiles(bootstrap) {
  const root = roots().find((item) => item.namespace === 'bloks');
  if (!root || !bootstrap?.files || typeof bootstrap.files !== 'object') {
    throw new Error('bootstrap files missing');
  }
  let restored = 0;
  for (const [path, text] of Object.entries(bootstrap.files)) {
    const target = targetFor(root.dir, path);
    if (!target || typeof text !== 'string') continue;
    await atomicWrite(target, Buffer.from(text), 0o600);
    restored += 1;
  }
  return restored;
}

function loadS3() {
  const require = createRequire(import.meta.url);
  const modulePath = join(homedir(), '.local', 'lib', 'node_modules', '@aws-sdk', 'client-s3');
  return require(modulePath);
}

function missingObject(error) {
  const code = error?.name || error?.Code || error?.code;
  const status = error?.$metadata?.httpStatusCode;
  return code === 'NoSuchKey' || code === 'NotFound' || status === 404;
}

async function bodyBuffer(body) {
  if (!body) return Buffer.alloc(0);
  if (typeof body.transformToByteArray === 'function') {
    return Buffer.from(await body.transformToByteArray());
  }
  const chunks = [];
  for await (const chunk of body) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}

class ObjectPersistence {
  constructor(config, bootstrap, logger = console) {
    this.config = config;
    this.bootstrap = bootstrap;
    this.logger = logger;
    this.ready = false;
    this.enabled = true;
    this.reason = null;
    this.timer = null;
    this.inFlight = null;
    const { S3Client, GetObjectCommand, PutObjectCommand } = loadS3();
    this.GetObjectCommand = GetObjectCommand;
    this.PutObjectCommand = PutObjectCommand;
    this.client = new S3Client({
      region: config.region,
      endpoint: config.endpoint,
      forcePathStyle: true,
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
      },
    });
  }

  async restore() {
    let source = 'object';
    try {
      const response = await this.client.send(new this.GetObjectCommand({
        Bucket: this.config.bucket,
        Key: this.config.objectKey,
      }));
      const compressed = await bodyBuffer(response.Body);
      const manifest = JSON.parse(gunzipSync(compressed).toString('utf8'));
      const restored = await restoreManifest(manifest);
      this.logger.log?.(`[diza-object] restored ${restored} persisted file(s)`);
    } catch (error) {
      if (!missingObject(error)) throw error;
      source = 'bootstrap';
      const restored = await applyBootstrapFiles(this.bootstrap);
      this.logger.warn?.(`[diza-object] bucket empty; restored ${restored} bootstrap file(s)`);
    }
    this.ready = true;
    if (source === 'bootstrap') await this.sync('bootstrap');
    return { restored: true, source };
  }

  async sync(reason = 'interval') {
    if (!this.ready) return { synced: false, reason: 'not-ready' };
    if (this.inFlight) return this.inFlight;
    this.inFlight = this.#sync(reason).finally(() => { this.inFlight = null; });
    return this.inFlight;
  }

  async #sync(reason) {
    const manifest = await buildManifest();
    const body = gzipSync(Buffer.from(JSON.stringify(manifest)), { level: 9 });
    await this.client.send(new this.PutObjectCommand({
      Bucket: this.config.bucket,
      Key: this.config.objectKey,
      Body: body,
      ContentType: 'application/gzip',
    }));
    if (reason !== 'interval') {
      this.logger.log?.(`[diza-object] sync ${reason}: ${manifest.files.length} file(s), ${body.length} bytes`);
    }
    return { synced: true, files: manifest.files.length, bytes: body.length };
  }

  start() {
    if (!this.ready || this.timer) return;
    const configured = Number(process.env.DIZA_PERSIST_INTERVAL_MS);
    const interval = Number.isFinite(configured) && configured >= 5_000 ? configured : DEFAULT_INTERVAL_MS;
    this.timer = setInterval(() => void this.sync('interval').catch((error) => {
      this.logger.error?.(`[diza-object] interval sync failed: ${error?.message || error}`);
    }), interval);
    this.timer.unref?.();
  }

  async close() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    try {
      await this.sync('shutdown');
    } finally {
      this.client.destroy?.();
    }
  }
}

const disabled = (reason, logger = console) => ({
  enabled: false,
  ready: false,
  reason,
  start() {},
  async close() {},
  async sync() { return { synced: false, reason }; },
});

export async function initializeObjectPersistence(logger = console) {
  let payload;
  try {
    payload = decryptBootstrap(process.env.DATABASE_URL || process.env.NEON_DATABASE_URL || '');
  } catch (error) {
    logger.error?.(`[diza-object] bootstrap decrypt failed: ${error?.message || error}`);
    return disabled('bootstrap-decrypt-failed', logger);
  }
  const persistence = new ObjectPersistence(payload.storage, payload.bootstrap, logger);
  try {
    await persistence.restore();
    return persistence;
  } catch (error) {
    logger.error?.(`[diza-object] restore failed: ${error?.message || error}`);
    await persistence.close().catch(() => {});
    return disabled('object-restore-failed', logger);
  }
}

export const __test = { safeRelativePath, targetFor, decryptBootstrap, missingObject };
