import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const server = fs.readFileSync("server/index.ts", "utf8");
const start = fs.readFileSync("deploy/start-web.sh", "utf8");
const web = fs.readFileSync("deploy/web.mjs", "utf8");

test("Faable marks itself as resource constrained without changing desktop behavior", () => {
  assert.match(start, /export DIZA_RESOURCE_CONSTRAINED=1/);
  assert.match(server, /const RESOURCE_CONSTRAINED = process\.env\.DIZA_RESOURCE_CONSTRAINED === "1"/);
});

test("constrained runtime defers post-turn model housekeeping but keeps preflight compaction", () => {
  assert.match(server, /if \(!RESOURCE_CONSTRAINED\) \{[\s\S]*?foldContext\(bot\.id, event\.threadId\)/);
  assert.match(server, /if \(!RESOURCE_CONSTRAINED\) \{[\s\S]*?microFold\(bot\.id, event\.threadId\)/);
  assert.match(server, /if \(!isSharedLane\(event\.threadId\)\) void reviewForSkill/);
  assert.match(server, /const providerSessionFull =[\s\S]*?shouldCompact/);
  assert.match(server, /if \(!blok && \(built\.dropped > 0 \|\| providerSessionFull\)\) \{[\s\S]*?await foldContext/);
});

test("Faable wrapper restarts one crashed core locally before recycling the container", () => {
  assert.match(web, /function scheduleCoreRestart\(reason\)/);
  assert.match(web, /coreRestartHistory\.length >= 3/);
  assert.match(web, /core stopped unexpectedly; restarting/);
  assert.match(web, /const gone = \(reason\) => \{[\s\S]*?scheduleCoreRestart\(reason\)/);
  assert.match(web, /child\.once\('exit', \(code, signal\) => gone/);
  assert.doesNotMatch(web, /child\.on\('exit', \(code\) => void stop/);
});
