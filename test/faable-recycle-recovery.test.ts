import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const store = fs.readFileSync("src/state/store.tsx", "utf8");
const web = fs.readFileSync("deploy/web.mjs", "utf8");

test("chat retries only requests explicitly rejected before the DIZA core accepted them", () => {
  assert.match(store, /for \(let attempt = 0; attempt < 9; attempt \+= 1\)/);
  assert.match(store, /message === "APP_UNREACHABLE"/);
  assert.match(store, /message === "DIZA backend is starting or unavailable"/);
  assert.match(store, /message\.startsWith\("DIZA persistence is unavailable\."\)/);
  assert.match(store, /if \(!definitelyNotAccepted \|\| attempt === 8\) throw new Error\(message\)/);
  assert.doesNotMatch(store, /catch \([^)]*\) \{[\s\S]{0,160}sendStreamingTurn/);
});

test("gateway logs platform lifecycle signals without changing graceful shutdown behavior", () => {
  assert.match(web, /received \$\{signal\}; shutting down gracefully/);
  assert.match(web, /for \(const signal of \['SIGTERM', 'SIGINT'\]\)/);
  assert.match(web, /void stop\(\)/);
});
