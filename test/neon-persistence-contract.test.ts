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


test("bot roster recovery only triggers for a fresh bootstrap over existing rooms", async () => {
  const { __test } = await import("../deploy/neon-persistence.mjs");
  const rooms = [{ memberIds: ["diza-old", "rani-old"] }];
  assert.equal(__test.needsBotRosterRecovery([{ id: "fresh-diza" }], rooms), true);
  assert.equal(__test.needsBotRosterRecovery([{ id: "diza-old" }], rooms), false);
  assert.equal(__test.needsBotRosterRecovery([{ id: "fresh-diza" }], []), false);
});

test("recovery roster must uniquely cover every persisted room member", async () => {
  const { __test } = await import("../deploy/neon-persistence.mjs");
  const rooms = [{ memberIds: ["diza-old", "rani-old"] }];
  assert.equal(
    __test.validRecoveryRoster(
      { kind: "bots-recovery", bots: [{ id: "diza-old" }, { id: "rani-old" }] },
      rooms,
    ),
    true,
  );
  assert.equal(
    __test.validRecoveryRoster(
      { kind: "bots-recovery", bots: [{ id: "diza-old" }] },
      rooms,
    ),
    false,
  );
  assert.equal(
    __test.validRecoveryRoster(
      { kind: "bots-recovery", bots: [{ id: "diza-old" }, { id: "diza-old" }, { id: "rani-old" }] },
      rooms,
    ),
    false,
  );
});

test("startup invokes roster repair only after normal Neon restore", () => {
  const restoreAt = source.indexOf("await persistence.restore()");
  const repairAt = source.indexOf("await persistence.recoverBotRosterIfNeeded()");
  assert.ok(restoreAt >= 0 && repairAt > restoreAt);
  assert.match(source, /WHERE slot LIKE 'recovery-bots-%'/);
  assert.match(source, /sha256\(Buffer\.from\(row\.payload\)\) !== row\.sha256/);
  assert.match(source, /await atomicWrite\(botsPath, recovered, 0o600\)/);
});
