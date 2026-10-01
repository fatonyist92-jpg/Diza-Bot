import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import test from "node:test";

const source = fs.readFileSync("deploy/object-persistence.mjs", "utf8");
const encrypted = fs.readFileSync("deploy/diza-storage-bootstrap.enc.json", "utf8");

test("object persistence module remains valid JavaScript", () => {
  const checked = spawnSync(process.execPath, ["--check", "deploy/object-persistence.mjs"], { encoding: "utf8" });
  assert.equal(checked.status, 0, checked.stderr || checked.stdout);
});

test("bootstrap stays encrypted in the public repository", () => {
  const envelope = JSON.parse(encrypted);
  assert.equal(envelope.version, 2);
  assert.equal(envelope.aad, "diza-storage-bootstrap-v2");
  assert.equal(typeof envelope.data, "string");
  assert.ok(envelope.data.length > 1000);
  assert.doesNotMatch(encrypted, /secretAccessKey|postgresql:\/\//);
  assert.doesNotMatch(encrypted, /Production Engineer Saniter|Personal AI Assistant/);
  assert.match(source, /DIZA_STORAGE_V2\\0\$\{password\}/);
  assert.match(source, /new URL\(databaseUrl\)\.password/);
});

test("object storage preserves DIZA core plus CLI auth, not rebuildable traces", () => {
  assert.match(source, /namespace: 'bloks'/);
  assert.match(source, /path === 'native'/);
  assert.match(source, /path === 'events'/);
  assert.match(source, /path === 'artifacts'/);
  assert.match(source, /path === 'attachments'/);
  assert.match(source, /namespace: 'grok'[\s\S]{0,240}path === 'auth\.json'/);
  assert.match(source, /namespace: 'codex'[\s\S]{0,280}\['auth\.json', 'config\.toml', 'environments\.toml'\]/);
});

test("empty bucket seeds the encrypted five-agent bootstrap then immediately persists it", () => {
  assert.match(source, /if \(!missingObject\(error\)\) throw error/);
  assert.match(source, /applyBootstrapFiles\(this\.bootstrap\)/);
  assert.match(source, /if \(source === 'bootstrap'\) await this\.sync\('bootstrap'\)/);
});

test("snapshot upload is private S3 state and periodic persistence remains bounded", () => {
  assert.match(source, /new S3Client\(/);
  assert.match(source, /forcePathStyle: true/);
  assert.match(source, /new this\.PutObjectCommand/);
  assert.match(source, /MAX_FILE_BYTES = 4 \* 1024 \* 1024/);
  assert.match(source, /MAX_TOTAL_BYTES = 32 \* 1024 \* 1024/);
  assert.match(source, /DEFAULT_INTERVAL_MS = 30_000/);
});


test("durable object credential bootstrap is public-readable only as DIZA_WEB_PASSWORD ciphertext", () => {
  assert.match(source, /PUBLIC_BOOTSTRAP_BUCKET = 'diza-bootstrap'/);
  assert.match(source, /DIZA_PUBLIC_BOOTSTRAP_V1\\0\$\{webPassword\}/);
  assert.match(source, /sealPublicStorageConfig/);
  assert.match(source, /openPublicStorageConfig/);
  assert.match(source, /persistPublicBootstrap\(webPassword\)/);
  assert.match(source, /loadPublicStorageConfig\(webPassword\)/);
});

test("one-time recovery uses only the raw encrypted bootstrap key then seals credentials durably", () => {
  assert.match(source, /decryptBootstrapWithRawKey\(rawKey\)/);
  assert.match(source, /rawKey\.length !== 32/);
  assert.match(source, /recoverObjectPersistenceWithRawKey/);
  assert.match(source, /await persistence\.persistPublicBootstrap\(webPassword\)/);
});
