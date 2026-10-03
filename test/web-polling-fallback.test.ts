import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const store = fs.readFileSync("src/state/store.tsx", "utf8");

test("SSE remains primary and polling starts only after repeated stream failures", () => {
  assert.match(store, /new EventSource/);
  assert.match(store, /streamFailures >= 3/);
  assert.match(store, /pollTimer = setInterval\(loadAll, 2000\)/);
});

test("polling fallback backs off SSE retries and stops when SSE recovers", () => {
  assert.match(store, /streamFailures >= 3 \? 15_000 : 1500/);
  assert.match(store, /es\.onopen = \(\) => \{[\s\S]*stopPollingFallback\(\)/);
  assert.match(store, /stopPollingFallback\(\);[\s\S]*es\?\.close\(\)/);
});
