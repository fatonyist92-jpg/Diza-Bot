import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const index = fs.readFileSync(path.resolve("server/index.ts"), "utf8");
const store = fs.readFileSync(path.resolve("server/store.ts"), "utf8");

test("conversation owns explicit project scope instead of ambiguous agent membership", () => {
  assert.match(store, /projectId\?: string/);
  assert.match(store, /\.\.\.\(source\.projectId \? \{ projectId: source\.projectId \} : \{\}\)/);
  assert.match(index, /const project = task\.projectId \? projects\.get\(task\.projectId\) : null/);
  assert.doesNotMatch(index, /const project = projects\.forAgent\(bot\.id\)/);
});

test("project-scoped new chat validates membership", () => {
  assert.match(index, /if \(!project\.memberIds\.includes\(bot\.id\)\)/);
  assert.match(index, /store\.createTask\(bot\.id, title, projectId\)/);
});

test("project memory and project assets compose separately from bot memory", () => {
  assert.match(index, /projectMemoryPrompt\(project\)/);
  assert.match(index, /projectAssetsPrompt\(project\)/);
  assert.match(index, /workspace\.memoryPrompt\(bot\.id\)/);
});

test("a scoped chat fails closed when its project is archived or missing", () => {
  assert.match(index, /task\.projectId && \(!project \|\| project\.archivedAt\)/);
  assert.match(index, /belongs to a project that is archived or no longer exists/);
});
