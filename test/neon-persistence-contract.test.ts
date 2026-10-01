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

test("DIZA core files are retained while rebuildable Codex caches are excluded", () => {
  assert.match(source, /path === 'cache'/);
  assert.match(source, /path\.startsWith\('cache\/'\)/);
  assert.match(source, /path === 'plugins\/cache'/);
  assert.match(source, /path\.startsWith\('plugins\/cache\/'\)/);
  assert.match(source, /MAX_FILE_BYTES = 128 \* 1024 \* 1024/);
  assert.doesNotMatch(source, /namespace: 'bloks'[\s\S]{0,180}exclude: \(path\)/);
});

test("a failed restore row cannot be deleted by the next sync", () => {
  assert.match(source, /this\.restoreFailures = new Set\(\)/);
  assert.match(source, /this\.restoreFailures\.add\(key\)/);
  assert.match(source, /seen\.has\(key\) \|\| this\.restoreFailures\.has\(key\)/);
});
