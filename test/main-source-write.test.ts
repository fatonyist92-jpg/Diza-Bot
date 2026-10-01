import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("shared Main Source is a durable writable root under DIZA data", async () => {
  const source = readFileSync("server/workspace.ts", "utf8");
  const server = readFileSync("server/index.ts", "utf8");
  assert.match(source, /const MAIN_SOURCE = join\(DATA_DIR, "main-source"\)/);
  assert.match(source, /export function ensureMainSource\(\)/);
  assert.match(source, /Shared Main Source:/);
  assert.match(server, /extraDirs: \[ownWorkspace, sharedMainSource\]/);
  assert.match(server, /workspace\.mainSourcePrompt\(\)/);
});

test("Main Source stays inside the bloks persistence namespace", () => {
  const persistence = readFileSync("deploy/neon-persistence.mjs", "utf8");
  assert.match(persistence, /namespace: 'bloks'/);
  assert.match(persistence, /process\.env\.DIZA_DATA_DIR \|\| join\(homedir\(\), '\.bloks'\)/);
  const workspace = readFileSync("server/workspace.ts", "utf8");
  assert.match(workspace, /MAIN_SOURCE = join\(DATA_DIR, "main-source"\)/);
});
