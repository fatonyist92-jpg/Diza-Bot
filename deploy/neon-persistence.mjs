import { createHash } from 'node:crypto';
import { mkdir, readdir, readFile, rename, stat, unlink, writeFile, chmod } from 'node:fs/promises';
import { homedir } from 'node:os';
import { createRequire } from 'node:module';
import { dirname, join, posix, resolve, sep } from 'node:path';
import { gzipSync, gunzipSync } from 'node:zlib';

const VERSION = 1;
const DEFAULT_INTERVAL_MS = 30_000;
const MAX_FILE_BYTES = 128 * 1024 * 1024;
const MAX_TOTAL_BYTES = 384 * 1024 * 1024;
const RESTORE_CHUNK_BYTES = 512 * 1024;
const SNAPSHOT_SLOT = 'primary';
const PERSIST_SCHEMA = process.env.DIZA_PERSIST_SCHEMA || 'diza_faable';
if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(PERSIST_SCHEMA)) {
  throw new Error('DIZA_PERSIST_SCHEMA must be a simple PostgreSQL identifier');
}
const quoteIdentifier = (value) => `"${value.replaceAll('"', '""')}"`;
const PERSIST_FILES_TABLE = `${quoteIdentifier(PERSIST_SCHEMA)}."diza_persist_files"`;
const RUNTIME_SNAPSHOTS_TABLE = `${quoteIdentifier(PERSIST_SCHEMA)}."diza_runtime_snapshots"`;

const roots = () => [
  {
    namespace: 'bloks',
    dir: process.env.DIZA_DATA_DIR || join(homedir(), '.bloks'),
    // Provider/native traces are diagnostics, not DIZA memory. Persisting
    // them rewrites tens or hundreds of MB every few seconds and can burn
    // through a free database quota while bots/messages themselves are tiny.
    exclude: (path) =>
      path === 'native' ||
      path.startsWith('native/') ||
      path === 'events' ||
      path.startsWith('events/'),
  },
  {
    namespace: 'grok',
    dir: process.env.DIZA_PERSIST_GROK_HOME || process.env.GROK_HOME || join(homedir(), '.grok'),
    // Grok continuity can be rebuilt from DIZA's transcript. Only the login
    // credential needs to survive an ephemeral Faable restart.
    exclude: (path) => path !== 'auth.json',
  },
  {
    namespace: 'codex',
    dir: process.env.DIZA_PERSIST_CODEX_HOME || process.env.CODEX_HOME || join(homedir(), '.codex'),
    // Same rule as Grok: keep credentials/config, not provider session logs.
    // DIZA retires provider cursors after restore so the next turn safely
    // replays transcript into a fresh native session.
    exclude: (path) => !['auth.json', 'config.toml', 'environments.toml'].includes(path),
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

function uniqueIds(values) {
  return new Set(values.filter((value) => typeof value === 'string' && value.length > 0));
}

function needsBotRosterRecovery(bots, rooms) {
  if (!Array.isArray(bots) || !Array.isArray(rooms)) return false;
  const botIds = uniqueIds(bots.map((bot) => bot?.id));
  const roomIds = uniqueIds(rooms.flatMap((room) => Array.isArray(room?.memberIds) ? room.memberIds : []));
  if (!roomIds.size || !botIds.size) return false;
  let overlap = 0;
  let missing = 0;
  for (const id of roomIds) {
    if (botIds.has(id)) overlap += 1;
    else missing += 1;
  }
  // Deliberately conservative: only repair the exact "fresh bootstrap over
  // an existing workspace" shape, where none of the room's known agents
  // exist in bots.json. A partial mismatch could be a legitimate edit and
  // must never be silently rolled back.
  return overlap === 0 && missing === roomIds.size;
}

function validRecoveryRoster(payload, rooms) {
  if (!payload || payload.kind !== 'bots-recovery' || !Array.isArray(payload.bots)) return false;
  const ids = payload.bots.map((bot) => bot?.id);
  const candidateIds = uniqueIds(ids);
  if (!candidateIds.size || candidateIds.size !== ids.length) return false;
  const required = uniqueIds(rooms.flatMap((room) => Array.isArray(room?.memberIds) ? room.memberIds : []));
  for (const id of required) if (!candidateIds.has(id)) return false;
  return true;
}

function endpointFor(connectionString) {
  const url = new URL(connectionString);
  if (!['postgres:', 'postgresql:'].includes(url.protocol)) throw new Error('DATABASE_URL must be a PostgreSQL URL');
  if (!url.hostname) throw new Error('DATABASE_URL has no hostname');
  return `https://${url.hostname}/sql`;
}

function makeRpcClient(logger = console) {
  const baseUrl = String(process.env.DIZA_PERSIST_API_URL || '').replace(/\/$/, '');
  const publishableKey = process.env.SUPABASE_PUBLISHABLE_KEY;
  const token = process.env.DIZA_PERSIST_TOKEN;
  if (!baseUrl || !publishableKey || !token) {
    throw new Error('Supabase persistence RPC requires DIZA_PERSIST_API_URL, SUPABASE_PUBLISHABLE_KEY, and DIZA_PERSIST_TOKEN');
  }

  let announced = false;
  const call = async (name, body = {}) => {
    const response = await fetch(`${baseUrl}/rest/v1/rpc/${name}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        apikey: publishableKey,
        'x-diza-token': token,
      },
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new Error(`Supabase persistence RPC ${name} failed (${response.status}): ${text.slice(0, 240)}`);
    }
    if (!announced) {
      announced = true;
      logger.log?.('[diza-persist] using authenticated Supabase RPC persistence path');
    }
    const raw = await response.text();
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  };

  const queryFn = async (query, params = []) => {
    const normalized = query.replace(/\s+/g, ' ').trim();

    if (/^CREATE TABLE IF NOT EXISTS /i.test(normalized)) return [];

    if (normalized.includes('octet_length(data) AS stored_bytes')) {
      return call('diza_faable_list_meta');
    }
    if (normalized.includes('substring(data from $3::integer for $4::integer)')) {
      return call('diza_faable_read_chunk', {
        p_namespace: params[0],
        p_path: params[1],
        p_offset: params[2],
        p_length: params[3],
      });
    }
    if (normalized.includes("WHERE slot LIKE 'recovery-bots-%'")) {
      return call('diza_faable_latest_recovery');
    }
    if (normalized.startsWith('SELECT namespace, path, sha256') && normalized.includes(PERSIST_FILES_TABLE)) {
      return call('diza_faable_list_existing');
    }
    if (normalized.startsWith(`INSERT INTO ${PERSIST_FILES_TABLE}`)) {
      const payload = params[3];
      if (!Buffer.isBuffer(payload)) throw new Error('Supabase persistence RPC expected a Buffer payload');
      await call('diza_faable_upsert_file', {
        p_namespace: params[0],
        p_path: params[1],
        p_sha256: params[2],
        p_data_hex: payload.toString('hex'),
        p_compressed: Boolean(params[4]),
        p_mode: Number(params[5]),
        p_size_bytes: Number(params[6]),
      });
      return [];
    }
    if (normalized.startsWith(`DELETE FROM ${PERSIST_FILES_TABLE}`)) {
      await call('diza_faable_delete_file', {
        p_namespace: params[0],
        p_path: params[1],
      });
      return [];
    }
    if (normalized.startsWith(`INSERT INTO ${RUNTIME_SNAPSHOTS_TABLE}`)) {
      await call('diza_faable_upsert_snapshot', {
        p_slot: params[0],
        p_payload: params[1],
        p_sha256: params[2],
      });
      return [];
    }

    throw new Error(`Unsupported Supabase persistence RPC query: ${normalized.slice(0, 160)}`);
  };

  queryFn.close = async () => {};
  return queryFn;
}

function makeClient(connectionString, logger = console) {
  const rpcEnv = [
    process.env.DIZA_PERSIST_API_URL,
    process.env.SUPABASE_PUBLISHABLE_KEY,
    process.env.DIZA_PERSIST_TOKEN,
  ];
  if (rpcEnv.every(Boolean)) return makeRpcClient(logger);
  if (rpcEnv.some(Boolean)) {
    throw new Error('Supabase persistence RPC is only partially configured');
  }
  if (!connectionString) throw new Error('DATABASE_URL is not configured');
  const databaseUrl = new URL(connectionString);
  const neonHttpAvailable = databaseUrl.hostname.endsWith('.neon.tech');
  const endpoint = neonHttpAvailable ? endpointFor(connectionString) : null;
  let directPool = null;
  let announcedDirect = false;

  const directQuery = async (query, params) => {
    if (!directPool) {
      const require = createRequire(import.meta.url);
      const { Pool } = require('pg');
      directPool = new Pool({
        connectionString,
        max: 1,
        idleTimeoutMillis: 10_000,
        connectionTimeoutMillis: 12_000,
        allowExitOnIdle: true,
      });
    }
    if (!announcedDirect) {
      announcedDirect = true;
      logger.warn?.('[diza-persist] Neon HTTP SQL unavailable; using direct Postgres restore/sync path');
    }
    const result = await directPool.query(query, params);
    return result.rows ?? [];
  };

  const queryFn = async (query, params = []) => {
    if (!neonHttpAvailable) return directQuery(query, params);
    const encoded = params.map((value) => {
      if (Buffer.isBuffer(value)) return `\\x${value.toString('hex')}`;
      if (value instanceof Date) return value.toISOString();
      return value;
    });
    try {
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
        const error = new Error(`Neon HTTP ${response.status}: ${body.slice(0, 240)}`);
        error.status = response.status;
        throw error;
      }
      const raw = await response.json();
      const names = Array.isArray(raw.fields) ? raw.fields.map((field) => field.name) : [];
      const rows = Array.isArray(raw.rows) ? raw.rows : [];
      return rows.map((row) => Object.fromEntries(row.map((value, index) => [names[index], value])));
    } catch (error) {
      // A free-tier HTTP SQL quota refusal should not strand an otherwise
      // reachable Postgres database. Direct TCP uses the same DATABASE_URL
      // and the same role; there is no second copy of user data.
      try {
        return await directQuery(query, params);
      } catch (directError) {
        const http = error?.message || String(error);
        const direct = directError?.message || String(directError);
        throw new Error(`${http}; direct Postgres also failed: ${direct}`);
      }
    }
  };

  queryFn.close = async () => {
    if (!directPool) return;
    const pool = directPool;
    directPool = null;
    await pool.end().catch(() => {});
  };
  return queryFn;
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
    this.logger = logger;
    this.query = makeClient(connectionString, logger);
    this.ready = false;
    this.timer = null;
    this.inFlight = null;
    this.rootList = roots();
    // A row that could not be restored must never be deleted merely
    // because the local copy is absent. Keep it until a later healthy
    // runtime successfully recreates/syncs that exact path.
    this.restoreFailures = new Set();
  }

  async ensureSchema() {
    await this.query(`
      CREATE TABLE IF NOT EXISTS ${PERSIST_FILES_TABLE} (
        namespace text NOT NULL,
        path text NOT NULL,
        sha256 text NOT NULL,
        data bytea NOT NULL,
        compressed boolean NOT NULL DEFAULT false,
        mode integer NOT NULL DEFAULT 384,
        size_bytes bigint NOT NULL DEFAULT 0,
        updated_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (namespace, path)
      )
    `);
    await this.query(`
      CREATE TABLE IF NOT EXISTS ${RUNTIME_SNAPSHOTS_TABLE} (
        slot text PRIMARY KEY,
        payload text NOT NULL,
        sha256 text NOT NULL,
        updated_at timestamptz NOT NULL DEFAULT now()
      )
    `);
  }

  async #readStoredData(row) {
    const storedBytes = Number(row.stored_bytes);
    if (!Number.isSafeInteger(storedBytes) || storedBytes < 0) {
      throw new Error('invalid stored byte count');
    }
    if (storedBytes === 0) return Buffer.alloc(0);

    const chunks = [];
    let received = 0;
    while (received < storedBytes) {
      const length = Math.min(RESTORE_CHUNK_BYTES, storedBytes - received);
      const rows = await this.query(`
        SELECT encode(substring(data from $3::integer for $4::integer), 'hex') AS data_hex
        FROM ${PERSIST_FILES_TABLE}
        WHERE namespace = $1 AND path = $2
      `, [row.namespace, row.path, received + 1, length]);
      const hex = rows[0]?.data_hex;
      if (typeof hex !== 'string' || hex.length % 2 !== 0 || !/^[0-9a-f]*$/i.test(hex)) {
        throw new Error('invalid restore chunk');
      }
      const chunk = Buffer.from(hex, 'hex');
      if (chunk.length !== length) {
        throw new Error(`restore chunk length mismatch: expected ${length}, got ${chunk.length}`);
      }
      chunks.push(chunk);
      received += chunk.length;
    }
    return Buffer.concat(chunks, storedBytes);
  }

  async restore() {
    // Fetch only metadata up front. Pulling every bytea as one giant hex
    // JSON response stops scaling once chat history and native logs grow.
    // Blob bytes are fetched below in bounded chunks instead.
    const rows = await this.query(`
      SELECT namespace, path, sha256, compressed, mode, size_bytes,
             octet_length(data) AS stored_bytes
      FROM ${PERSIST_FILES_TABLE}
      WHERE namespace IN ('bloks', 'grok', 'codex')
      ORDER BY namespace, path
    `);
    let restored = 0;
    let skipped = 0;
    for (const row of rows) {
      const root = this.rootList.find((item) => item.namespace === row.namespace);
      if (!root || root.exclude(row.path)) { skipped += 1; continue; }
      const target = targetFor(root.dir, row.path);
      if (!target) { skipped += 1; continue; }
      const key = `${row.namespace}\0${row.path}`;
      try {
        const stored = await this.#readStoredData(row);
        const data = asBool(row.compressed) ? gunzipSync(stored) : stored;
        if (sha256(data) !== row.sha256) throw new Error('sha256 mismatch');
        await atomicWrite(target, data, safeMode(row.mode));
        this.restoreFailures.delete(key);
        restored += 1;
      } catch (error) {
        this.restoreFailures.add(key);
        skipped += 1;
        this.logger.warn?.(`[diza-persist] skipped restore ${row.namespace}/${row.path}: ${error?.message || error}`);
      }
    }
    this.ready = true;
    this.logger.log?.(`[diza-persist] restore ready: ${restored} restored, ${skipped} skipped`);
    return { restored, skipped };
  }

  async recoverBotRosterIfNeeded() {
    const bloksRoot = this.rootList.find((root) => root.namespace === 'bloks');
    if (!bloksRoot) return { recovered: false, reason: 'no-bloks-root' };
    const botsPath = join(bloksRoot.dir, 'bots.json');
    const roomsPath = join(bloksRoot.dir, 'bloks.json');

    let bots;
    let rooms;
    try {
      bots = JSON.parse(await readFile(botsPath, 'utf8'));
      rooms = JSON.parse(await readFile(roomsPath, 'utf8'));
    } catch {
      return { recovered: false, reason: 'workspace-files-unreadable' };
    }
    if (!needsBotRosterRecovery(bots, rooms)) {
      return { recovered: false, reason: 'roster-consistent' };
    }

    const rows = await this.query(`
      SELECT slot, payload, sha256, updated_at
      FROM ${RUNTIME_SNAPSHOTS_TABLE}
      WHERE slot LIKE 'recovery-bots-%'
      ORDER BY updated_at DESC
      LIMIT 1
    `);
    const row = rows[0];
    if (!row || typeof row.payload !== 'string' || typeof row.sha256 !== 'string') {
      this.logger.warn?.('[diza-persist] bot roster mismatch detected but no recovery roster exists');
      return { recovered: false, reason: 'no-recovery-roster' };
    }
    if (sha256(Buffer.from(row.payload)) !== row.sha256) {
      this.logger.warn?.('[diza-persist] bot recovery roster failed checksum validation');
      return { recovered: false, reason: 'recovery-checksum-mismatch' };
    }

    let payload;
    try {
      payload = JSON.parse(row.payload);
    } catch {
      return { recovered: false, reason: 'recovery-json-invalid' };
    }
    if (!validRecoveryRoster(payload, rooms)) {
      this.logger.warn?.('[diza-persist] bot recovery roster does not cover the current room membership');
      return { recovered: false, reason: 'recovery-roster-invalid' };
    }

    const recovered = Buffer.from(JSON.stringify(payload.bots, null, 2));
    await atomicWrite(botsPath, recovered, 0o600);
    this.logger.warn?.(
      `[diza-persist] restored ${payload.bots.length} agents from ${row.slot} after detecting an empty-bootstrap roster`,
    );
    return { recovered: true, count: payload.bots.length, slot: row.slot };
  }

  async retireProviderCursorsAfterRestore() {
    const bloksRoot = this.rootList.find((root) => root.namespace === 'bloks');
    if (!bloksRoot) return { changed: false };
    const botsPath = join(bloksRoot.dir, 'bots.json');
    let bots;
    try {
      bots = JSON.parse(await readFile(botsPath, 'utf8'));
    } catch {
      return { changed: false };
    }
    if (!Array.isArray(bots)) return { changed: false };

    let changed = false;
    for (const bot of bots) {
      if (bot && typeof bot === 'object' && bot.resumeCursors && Object.keys(bot.resumeCursors).length) {
        bot.resumeCursors = {};
        changed = true;
      }
      for (const task of Array.isArray(bot?.tasks) ? bot.tasks : []) {
        if (task.resumeCursors && Object.keys(task.resumeCursors).length) {
          task.resumeCursors = {};
          changed = true;
        }
        if (task.lastInstanceId !== undefined) {
          delete task.lastInstanceId;
          changed = true;
        }
        if (task.lastModel !== undefined) {
          delete task.lastModel;
          changed = true;
        }
        if ((task.lastInput ?? 0) !== 0) {
          task.lastInput = 0;
          changed = true;
        }
      }
    }
    if (changed) {
      await atomicWrite(botsPath, Buffer.from(JSON.stringify(bots, null, 2)), 0o600);
      this.logger.log?.('[diza-persist] retired native provider cursors; transcript will replay into fresh sessions');
    }
    return { changed };
  }

  async sync(reason = 'interval') {
    if (!this.ready) return { synced: false, reason: 'not-ready' };
    if (this.inFlight) {
      const running = this.inFlight;
      await running;
      // An interval may safely share another scan. A mutation may not:
      // the running scan could have enumerated the filesystem before the
      // mutation landed, so give every mutation a pass that starts after
      // the previous scan has completely settled.
      if (reason === 'interval') return running;
      return this.sync(reason);
    }
    this.inFlight = this.#sync(reason).finally(() => { this.inFlight = null; });
    return this.inFlight;
  }

  async #sync(reason) {
    // Never prune old excluded rows automatically. They may be useful for
    // forensic recovery, and deleting user/provider history is a separate,
    // explicit maintenance decision. We simply stop rewriting them.
    const existingRows = await this.query(`
      SELECT namespace, path, sha256
      FROM ${PERSIST_FILES_TABLE}
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
        this.restoreFailures.delete(key);
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
          INSERT INTO ${PERSIST_FILES_TABLE}
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
      const root = this.rootList.find((item) => item.namespace === row.namespace);
      if (!root || root.exclude(row.path)) continue;
      if (seen.has(key) || this.restoreFailures.has(key)) continue;
      await this.query(
        `DELETE FROM ${PERSIST_FILES_TABLE} WHERE namespace = $1 AND path = $2`,
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
      INSERT INTO ${RUNTIME_SNAPSHOTS_TABLE} (slot, payload, sha256, updated_at)
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
    } finally {
      await this.query.close?.();
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

export async function initializeNeonPersistence(logger = console) {
  const connectionString = process.env.DATABASE_URL || process.env.NEON_DATABASE_URL || null;
  const rpcConfigured = Boolean(
    process.env.DIZA_PERSIST_API_URL &&
    process.env.SUPABASE_PUBLISHABLE_KEY &&
    process.env.DIZA_PERSIST_TOKEN
  );
  if (!connectionString && !rpcConfigured) {
    logger.warn?.('[diza-persist] no persistence backend is configured');
    return disabled('missing-persistence-config', logger);
  }
  let persistence;
  try {
    persistence = new NeonPersistence(connectionString, logger);
    await persistence.ensureSchema();
    await persistence.restore();
    await persistence.recoverBotRosterIfNeeded();
    await persistence.retireProviderCursorsAfterRestore();
  } catch (error) {
    logger.error?.(`[diza-persist] restore failed; persistence disabled for this process: ${error?.message || error}`);
    return disabled('restore-failed', logger);
  }
  return Object.assign(persistence, { enabled: true, reason: null });
}

export const __test = {
  safeRelativePath,
  targetFor,
  endpointFor,
  sha256,
  needsBotRosterRecovery,
  validRecoveryRoster,
};
