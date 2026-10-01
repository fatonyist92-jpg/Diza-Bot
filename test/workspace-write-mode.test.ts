import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const workspace = readFileSync("server/workspace.ts", "utf8");
const server = readFileSync("server/index.ts", "utf8");
const codex = readFileSync("server/drivers/codex.ts", "utf8");

test("every bot workspace has a durable writable library area", () => {
  assert.match(workspace, /mkdirSync\(join\(dir, "library"\), \{ recursive: true, mode: 0o700 \}\)/);
  assert.match(workspace, /export function writableWorkspacePrompt\(botId: string\)/);
  assert.match(workspace, /It is writable, not read-only/);
  assert.match(workspace, /There is no separate 'Allow write access' or 'Edit Workspace' button/);
});

test("process-based bots are explicitly told about writable workspace", () => {
  assert.match(
    server,
    /!sharing && runsAProcess\(instance\.driverKind\) && workspace\.writableWorkspacePrompt\(bot\.id\)/,
  );
  assert.match(
    server,
    /extraDirs: \[workspace\.ensureWorkspace\(bot\.id\)\]/,
  );
});

test("Codex remains sandboxed to workspace-write instead of full host access", () => {
  assert.match(codex, /sandbox: config\.fullAuto \? "danger-full-access" : "workspace-write"/);
  assert.match(codex, /runtimeWorkspaceRoots/);
});
