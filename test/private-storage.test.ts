import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, statSync, rmSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { atomicPrivateWrite } from "../server/private-storage.ts";

test("atomic private write replaces content and keeps POSIX state private", () => {
  const dir = mkdtempSync(join(tmpdir(), "diza-private-"));
  const file = join(dir, "state.json");
  try {
    atomicPrivateWrite(file, "one");
    atomicPrivateWrite(file, "two");
    assert.equal(readFileSync(file, "utf8"), "two");
    if (process.platform !== "win32") assert.equal(statSync(file).mode & 0o777, 0o600);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});


test("a failed replacement cleans its temporary sibling", () => {
  const dir = mkdtempSync(join(tmpdir(), "diza-private-fail-"));
  const before = new Set(readdirSync(dir));
  try {
    assert.throws(() => atomicPrivateWrite(dir, "cannot replace a directory"));
    assert.deepEqual(new Set(readdirSync(dir)), before);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
