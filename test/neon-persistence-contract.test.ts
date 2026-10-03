import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import test from "node:test";

const source = fs.readFileSync("deploy/neon-persistence.mjs", "utf8");

test("Neon persistence module remains valid JavaScript", () => {
  const checked = spawnSync(process.execPath, ["--check", "deploy/neon-persistence.mjs"], { encoding: "utf8" });
  assert.equal(checked.status, 0, checked.stderr || checked.stdout);
});

test("large restore payloads are fetched in bounded chunks", () => {
  assert.match(source, /RESTORE_CHUNK_BYTES = 512 \* 1024/);
  assert.match(source, /octet_length\(data\) AS stored_bytes/);
  assert.match(source, /substring\(data from \$3::integer for \$4::integer\)/);
  assert.match(source, /Buffer\.concat\(chunks, storedBytes\)/);
  assert.doesNotMatch(source, /SELECT namespace, path, sha256, encode\(data, 'hex'\) AS data_hex/);
});

test("persistence keeps durable workspace/auth state and skips rebuildable native traces", () => {
  assert.match(source, /path === 'native'/);
  assert.match(source, /path\.startsWith\('native\/'\)/);
  assert.match(source, /path === 'events'/);
  assert.match(source, /path\.startsWith\('events\/'\)/);
  assert.match(source, /namespace: 'grok'[\s\S]{0,420}path !== 'auth\.json'/);
  assert.match(source, /\['auth\.json', 'config\.toml', 'environments\.toml'\]/);
  assert.match(source, /DEFAULT_INTERVAL_MS = 30_000/);
});

test("a mutation arriving during another sync gets a fresh persistence pass", () => {
  assert.match(source, /if \(this\.inFlight\) \{[\s\S]{0,220}await running/);
  assert.match(source, /if \(reason === 'interval'\) return running/);
  assert.match(source, /return this\.sync\(reason\)/);
});

test("a failed restore row cannot be deleted by the next sync", () => {
  assert.match(source, /this\.restoreFailures = new Set\(\)/);
  assert.match(source, /this\.restoreFailures\.add\(key\)/);
  assert.match(source, /seen\.has\(key\) \|\| this\.restoreFailures\.has\(key\)/);
});


test("bot roster recovery is conservative and requires zero overlap with persisted room agents", () => {
  assert.match(source, /return overlap === 0 && missing === roomIds\.size/);
  assert.match(source, /if \(!roomIds\.size \|\| !botIds\.size\) return false/);
});

test("recovery roster must uniquely cover every persisted room member", () => {
  assert.match(source, /candidateIds\.size !== ids\.length/);
  assert.match(source, /for \(const id of required\) if \(!candidateIds\.has\(id\)\) return false/);
  assert.match(source, /payload\.kind !== 'bots-recovery'/);
});

test("startup invokes roster repair only after normal Neon restore", () => {
  const restoreAt = source.indexOf("await persistence.restore()");
  const repairAt = source.indexOf("await persistence.recoverBotRosterIfNeeded()");
  assert.ok(restoreAt >= 0 && repairAt > restoreAt);
  assert.match(source, /WHERE slot LIKE 'recovery-bots-%'/);
  assert.match(source, /sha256\(Buffer\.from\(row\.payload\)\) !== row\.sha256/);
  assert.match(source, /await atomicWrite\(botsPath, recovered, 0o600\)/);
});


test("excluded legacy rows are preserved rather than silently deleted", () => {
  assert.match(source, /const root = this\.rootList\.find\(\(item\) => item\.namespace === row\.namespace\)/);
  assert.match(source, /if \(!root \|\| root\.exclude\(row\.path\)\) continue/);
  assert.doesNotMatch(source, /DELETE FROM public\.diza_persist_files[\s\S]{0,300}path = 'cache'/);
});

test("HTTP SQL failure can fall back to the same database over direct Postgres", () => {
  assert.match(source, /createRequire/);
  assert.match(source, /require\('pg'\)/);
  assert.match(source, /new Pool\(/);
  assert.match(source, /direct Postgres also failed/);
});

test("fresh PostgreSQL databases create the two persistence tables before restore", () => {
  const schemaAt = source.indexOf("await persistence.ensureSchema()");
  const restoreAt = source.indexOf("await persistence.restore()");
  assert.ok(schemaAt >= 0 && restoreAt > schemaAt);
  assert.match(source, /CREATE TABLE IF NOT EXISTS \$\{PERSIST_FILES_TABLE\}/);
  assert.match(source, /CREATE TABLE IF NOT EXISTS \$\{RUNTIME_SNAPSHOTS_TABLE\}/);
});

test("Faable defaults to its isolated Supabase schema", () => {
  assert.match(source, /DIZA_PERSIST_SCHEMA \|\| 'diza_faable'/);
  assert.match(source, /PERSIST_FILES_TABLE/);
  assert.match(source, /RUNTIME_SNAPSHOTS_TABLE/);
  assert.doesNotMatch(source, /FROM public\.diza_persist_files/);
  assert.doesNotMatch(source, /INSERT INTO public\.diza_runtime_snapshots/);
});

test("non-Neon PostgreSQL uses the packaged direct driver", () => {
  assert.match(source, /databaseUrl\.hostname\.endsWith\('\.neon\.tech'\)/);
  assert.match(source, /if \(!neonHttpAvailable\) return directQuery\(query, params\)/);
  assert.match(source, /max: 1/);
  assert.match(source, /allowExitOnIdle: true/);
});

test("native provider cursors are retired after restore so transcript can replay", () => {
  const restoreAt = source.indexOf("await persistence.restore()");
  const retireAt = source.indexOf("await persistence.retireProviderCursorsAfterRestore()");
  assert.ok(restoreAt >= 0 && retireAt > restoreAt);
  assert.match(source, /task\.resumeCursors = \{\}/);
  assert.match(source, /delete task\.lastInstanceId/);
  assert.match(source, /task\.lastInput = 0/);
});


test("direct Postgres serializes restore and sync across overlapping Faable containers", () => {
  assert.match(source, /queryFn\.withPersistenceLock = async \(work\)/);
  assert.match(source, /pg_advisory_xact_lock\(hashtext\(\$1\)\)/);
  assert.match(source, /return this\.query\.withPersistenceLock[\s\S]{0,120}perform/);
});

test("restore chunks are version guarded and retried when another container updates a row", () => {
  assert.match(source, /WHERE namespace = \$1 AND path = \$2 AND sha256 = \$5/);
  assert.match(source, /stored row changed during restore/);
  assert.match(source, /for \(let attempt = 0; attempt < 3 && !done; attempt \+= 1\)/);
  assert.match(source, /WHERE namespace = \$1 AND path = \$2[\s\S]{0,180}current = fresh\[0\]/);
});

test("sync never uploads a file observed while it is changing", () => {
  assert.match(source, /async function readStableFile\(path, attempts = 3\)/);
  assert.match(source, /before\.size === data\.length/);
  assert.match(source, /after\.size === data\.length/);
  assert.match(source, /before\.mtimeMs === after\.mtimeMs/);
  assert.match(source, /const stable = await readStableFile\(file\.full\)/);
});
