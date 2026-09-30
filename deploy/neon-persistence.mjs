import { createHash } from 'node:crypto';
import { mkdir, readdir, readFile, rename, stat, unlink, writeFile, chmod } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join, posix, resolve, sep } from 'node:path';
import { gzipSync, gunzipSync } from 'node:zlib';

const VERSION = 1;
const DEFAULT_INTERVAL_MS = 5_000;
const MAX_FILE_BYTES = 64 * 1024 * 1024;
const MAX_TOTAL_BYTES = 384 * 1024 * 1024;
const SNAPSHOT_SLOT = 'primary';

const roots = () => [
  {
    namespace: 'bloks',
    dir: process.env.DIZA_DATA_DIR || join(homedir(), '.bloks'),
    exclude: () => false,
  },
  {
    namespace: 'grok',
    dir: process.env.GROK_HOME || join(homedir(), '.grok'),
    exclude: () => false,
  },
  {
    namespace: 'codex',
    dir: process.env.CODEX_HOME || join(homedir(), '.codex'),
    exclude: (path) => path === '.env' || path === 'node-root-ca.pem',
  },
];

const sha256 = (data) => createHash('sha256').update(data).digest('hex');
const asBool = (value) => value === true || value === 't' || value === 'true' || value === '1';
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

function endpointFor(connectionString) {
  const url = new URL(connectionString);
  if (!['postgres:', 'postgresql:'].includes(url.protocol)) throw new Error('DATABASE_URL must be a PostgreSQL URL');
  if (!url.hostname) throw new Error('DATABASE_URL has no hostname');
  return `https://${url.hostname}/sql`;
}

function makeClient(connectionString) {
  const endpoint = endpointFor(connectionString);
  return async (query, params = []) => {
    const encoded = params.map((value) => {
      if (Buffer.isBuffer(value)) return `\\x${value.toString('hex')}`;
      if (value instanceof Date) return value.toISOString();
      return value;
    });
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'Neon-Connection-String': connectionString,
        'Neon-Raw-Text-Output': 'true',
        'Neon-Array-Mode': 'true',
      },
      body: JSON.stringify({ query, params: encoded }),
    });
    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new Error(`Neon HTTP ${response.status}: ${body.slice(0, 240)}`);
    }
    const raw = await response.json();
    const names = Array.isArray(raw.fields) ? raw.fields.map((field) => field.name) : [];
    const rows = Array.isArray(raw.rows) ? raw.rows : [];
    return rows.map((row) => Object.fromEntries(row.map((value, index) => [names[index], value])));
  };
}

async function atomicWrite(target, data, mode) {
  await mkdir(dirname(target), { recursive: true, mode: 0o700 });
  const temp = `${target}.diza-restore-${process.pid}`;
  await writeFile(temp, data, { mode });
  await chmod(temp, mode).catch(() => {});
  await rename(temp, target);
  await chmod(target, mode).catch(() => {});
}

async function collectFiles(root) {
  const found = [];
  const base = resolve(root.dir);
  const walk = async (dir, prefix = '') => {
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
      if (root.exclude(rel) || rel.includes('.diza-restore-')) continue;
      const full = resolve(dir, entry.name);
      if (full !== base && !full.startsWith(`${base}${sep}`)) continue;
      if (entry.isDirectory()) {
        await walk(full, rel);
        continue;
      }
      if (!entry.isFile()) continue;
      let info;
      try {
        info = await stat(full);
      } catch {
        continue;
      }
      found.push({ path: rel, full, mode: info.mode & 0o777, size: info.size });
    }
  };
  await walk(base);
  return found;
}

class NeonPersistence {
  constructor(connectionString, logger = console) {
    this.query = makeClient(connectionString);
    this.logger = logger;
    this.ready = false;
    this.timer = null;
    this.inFlight = null;
    this.rootList = roots();
  }

  async restore() {
    const rows = await this.query(`
      SELECT namespace, path, sha256, encode(data, 'hex') AS data_hex,
             compressed, mode, size_bytes
      FROM public.diza_persist_files
      WHERE namespace IN ('bloks', 'grok', 'codex')
      ORDER BY namespace, path
    `);
    let restored = 0;
    let skipped = 0;
    for (const row of rows) {
      const root = this.rootList.find((item) => item.namespace === row.namespace);
      if (!root || root.exclude(row.path)) { skipped += 1; continue; }
      const target = targetFor(root.dir, row.path);
      if (!target || typeof row.data_hex !== 'string') { skipped += 1; continue; }
      try {
        const stored = Buffer.from(row.data_hex, 'hex');
        const data = asBool(row.compressed) ? gunzipSync(stored) : stored;
        if (sha256(data) !== row.sha256) throw new Error('sha256 mismatch');
        await atomicWrite(target, data, safeMode(row.mode));
        restored += 1;
      } catch (error) {
        skipped += 1;
        this.logger.warn?.(`[diza-persist] skipped restore ${row.namespace}/${row.path}: ${error?.message || error}`);
      }
    }
    this.ready = true;
    this.logger.log?.(`[diza-persist] restore ready: ${restored} restored, ${skipped} skipped`);
    return { restored, skipped };
  }

  async sync(reason = 'interval') {
    if (!this.ready) return { synced: false, reason: 'not-ready' };
    if (this.inFlight) return this.inFlight;
    this.inFlight = this.#sync(reason).finally(() => { this.inFlight = null; });
    return this.inFlight;
  }

  async #sync(reason) {
    const existingRows = await this.query(`
      SELECT namespace, path, sha256
      FROM public.diza_persist_files
      WHERE namespace IN ('bloks', 'grok', 'codex')
    `);
    const existing = new Map(existingRows.map((row) => [`${row.namespace}\0${row.path}`, row.sha256]));
    const seen = new Set();
    const namespaceStats = {};
    let totalBytes = 0;
    let writes = 0;
    let deletes = 0;
    let skipped = 0;

    for (const root of this.rootList) {
      const files = await collectFiles(root);
      namespaceStats[root.namespace] = { files: files.length, bytes: 0 };
      for (const file of files) {
        const key = `${root.namespace}\0${file.path}`;
        seen.add(key);
        namespaceStats[root.namespace].bytes += file.size;
        totalBytes += file.size;
        if (file.size > MAX_FILE_BYTES || totalBytes > MAX_TOTAL_BYTES) {
          skipped += 1;
          continue;
        }
        let data;
        try {
          data = await readFile(file.full);
        } catch {
          skipped += 1;
          continue;
        }
        const digest = sha256(data);
        if (existing.get(key) === digest) continue;
        let payload = data;
        let compressed = false;
        if (data.length >= 1024) {
          const gz = gzipSync(data);
          if (gz.length + 64 < data.length * 0.9) {
            payload = gz;
            compressed = true;
          }
        }
        await this.query(`
          INSERT INTO public.diza_persist_files
            (namespace, path, sha256, data, compressed, mode, size_bytes, updated_at)
          VALUES ($1, $2, $3, $4::bytea, $5, $6, $7, now())
          ON CONFLICT (namespace, path) DO UPDATE SET
            sha256 = EXCLUDED.sha256,
            data = EXCLUDED.data,
            compressed = EXCLUDED.compressed,
            mode = EXCLUDED.mode,
            size_bytes = EXCLUDED.size_bytes,
            updated_at = now()
        `, [root.namespace, file.path, digest, payload, compressed, file.mode || 0o600, data.length]);
        writes += 1;
      }
    }

    for (const row of existingRows) {
      const key = `${row.namespace}\0${row.path}`;
      if (seen.has(key)) continue;
      await this.query(
        'DELETE FROM public.diza_persist_files WHERE namespace = $1 AND path = $2',
        [row.namespace, row.path],
      );
      deletes += 1;
    }

    const snapshot = JSON.stringify({
      version: VERSION,
      syncedAt: new Date().toISOString(),
      reason,
      files: seen.size,
      totalBytes,
      namespaces: namespaceStats,
      writes,
      deletes,
      skipped,
    });
    await this.query(`
      INSERT INTO public.diza_runtime_snapshots (slot, payload, sha256, updated_at)
      VALUES ($1, $2, $3, now())
      ON CONFLICT (slot) DO UPDATE SET
        payload = EXCLUDED.payload,
        sha256 = EXCLUDED.sha256,
        updated_at = now()
    `, [SNAPSHOT_SLOT, snapshot, sha256(Buffer.from(snapshot))]);

    if (writes || deletes || reason !== 'interval') {
      this.logger.log?.(`[diza-persist] sync ${reason}: ${writes} write, ${deletes} delete, ${skipped} skipped`);
    }
    return { synced: true, writes, deletes, skipped, files: seen.size, totalBytes };
  }

  start() {
    if (!this.ready || this.timer) return;
    const configured = Number(process.env.DIZA_PERSIST_INTERVAL_MS);
    const interval = Number.isFinite(configured) && configured >= 2_000 ? configured : DEFAULT_INTERVAL_MS;
    setTimeout(() => void this.sync('startup').catch((error) => {
      this.logger.error?.(`[diza-persist] startup sync failed: ${error?.message || error}`);
    }), 2_000).unref?.();
    this.timer = setInterval(() => void this.sync('interval').catch((error) => {
      this.logger.error?.(`[diza-persist] interval sync failed: ${error?.message || error}`);
    }), interval);
    this.timer.unref?.();
  }

  async close() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    try {
      await this.sync('shutdown');
    } catch (error) {
      this.logger.error?.(`[diza-persist] shutdown sync failed: ${error?.message || error}`);
    }
  }
}

const disabled = (reason, logger = console) => ({
  enabled: false,
  ready: false,
  start() {},
  async close() {},
  async sync() { return { synced: false, reason }; },
});

export async function initializeNeonPersistence(logger = console) {
  const connectionString = process.env.DATABASE_URL || process.env.NEON_DATABASE_URL;
  if (!connectionString) {
    logger.warn?.('[diza-persist] DATABASE_URL is not configured; Neon persistence is disabled');
    return disabled('missing-database-url', logger);
  }
  const persistence = new NeonPersistence(connectionString, logger);
  try {
    await persistence.restore();
  } catch (error) {
    logger.error?.(`[diza-persist] restore failed; persistence disabled for this process: ${error?.message || error}`);
    return disabled('restore-failed', logger);
  }
  return Object.assign(persistence, { enabled: true });
}

export const __test = { safeRelativePath, targetFor, endpointFor, sha256 };
