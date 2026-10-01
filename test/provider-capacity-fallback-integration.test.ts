import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("interactive capacity failure retries once without duplicating the user message", () => {
  const server = readFileSync(new URL("../server/index.ts", import.meta.url), "utf8");
  assert.match(server, /isProviderCapacityError\(event\.message\)/);
  assert.match(server, /providerCapacityCooldowns\.set\(event\.providerInstanceId/);
  assert.match(server, /!retry\.hadEffects[\s\S]{0,120}retry\.fallbackDepth < 1/);
  assert.match(server, /presetMessage: true[\s\S]{0,240}avoidInstanceIds: \[capacityRetry\.failedInstanceId\]/);
  assert.match(server, /capacityFallbackDepth: capacityRetry\.fallbackDepth \+ 1/);
});

test("fallback context budgeting follows the engine and model that actually serve the turn", () => {
  const server = readFileSync(new URL("../server/index.ts", import.meta.url), "utf8");
  const store = readFileSync(new URL("../server/store.ts", import.meta.url), "utf8");
  assert.match(server, /const contextLimit = contextLimitFor\(turnModel\)/);
  assert.match(server, /task\.lastInstanceId === instance\.instanceId[\s\S]{0,180}contextLimitFor\(task\.lastModel \?\? turnModel\)/);
  assert.match(server, /markTaskDispatched\(bot\.id, task\.id, instanceId, turnModel\)/);
  assert.match(server, /contextLimitFor\(settledTask\?\.lastModel \?\? bot\.modelSelection\.model\)/);
  assert.match(store, /lastModel\?: string/);
});

test("tool use or assistant output disables automatic replay", () => {
  const server = readFileSync(new URL("../server/index.ts", import.meta.url), "utf8");
  assert.match(server, /case "item\.started":[\s\S]{0,220}retry\.hadEffects = true/);
  assert.match(server, /case "item\.completed":[\s\S]{0,220}assistant_text[\s\S]{0,220}retry\.hadEffects = true/);
});

test("Faable runtime installs the pinned Gemini CLI fallback", () => {
  const start = readFileSync(new URL("../deploy/start-web.sh", import.meta.url), "utf8");
  assert.match(start, /GEMINI_VERSION="0\.61\.0"/);
  assert.match(start, /@google\/gemini-cli@\$GEMINI_VERSION/);
  assert.match(start, /"\$GEMINI_BIN" --version/);
});
