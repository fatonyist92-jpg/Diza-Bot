import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

test("Faable opens the assigned port before slow CLI installation", () => {
  const start = fs.readFileSync("deploy/start-web.sh", "utf8");
  const warmup = fs.readFileSync("deploy/faable-warmup.mjs", "utf8");
  const warmupAt = start.indexOf("node deploy/faable-warmup.mjs &");
  const codexInstallAt = start.indexOf("npm install -g --prefix");
  const grokInstallAt = start.indexOf("@xai-official/grok");
  const handoffAt = start.lastIndexOf("cleanup_warmup");
  const webAt = start.lastIndexOf("exec node deploy/web.mjs");

  assert.ok(warmupAt >= 0, "warmup listener must start");
  assert.ok(codexInstallAt > warmupAt, "Codex install must happen after the port is open");
  assert.ok(grokInstallAt > warmupAt, "Grok install must happen after the port is open");
  assert.ok(handoffAt > grokInstallAt, "warmup must stay alive throughout CLI setup");
  assert.ok(webAt > handoffAt, "the real web gateway must take over after warmup closes");
  assert.match(warmup, /process\.env\.PORT \|\| 10000/);
  assert.match(warmup, /server\.listen\(port, "0\.0\.0\.0"/);
  assert.match(warmup, /starting: true/);
});
