import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

test("permanent agent deletion removes private memory and avatar bytes", () => {
  const server = fs.readFileSync("server/index.ts", "utf8");
  const workspace = fs.readFileSync("server/workspace.ts", "utf8");

  assert.match(server, /const forget = url\.searchParams\.get\("forget"\) === "1"/);
  assert.match(server, /workspace\.removeWorkspace\(bot\.id\)/);
  assert.match(server, /join\(AVATARS_DIR, bot\.id\)/);
  assert.match(server, /join\(AVATARS_DIR, `\$\{bot\.id\}\.mime`\)/);
  assert.match(workspace, /export function removeWorkspace\(botId: string\)/);
  assert.match(workspace, /rmSync\(workspaceDir\(botId\), \{ recursive: true, force: true \}\)/);
});

test("archiving an agent does not remove its private workspace or avatar", () => {
  const server = fs.readFileSync("server/index.ts", "utf8");
  const archiveAt = server.indexOf("if (!forget) {");
  const permanentAt = server.indexOf("workspace.removeWorkspace(bot.id)");
  assert.ok(archiveAt >= 0 && permanentAt > archiveAt);
  const archiveBlock = server.slice(archiveAt, permanentAt);
  assert.doesNotMatch(archiveBlock, /removeWorkspace/);
  assert.doesNotMatch(archiveBlock, /AVATARS_DIR/);
});
