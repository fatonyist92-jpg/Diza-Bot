import assert from "node:assert/strict";
import test from "node:test";

import {
  CAPACITY_COOLDOWN_MS,
  fallbackOrder,
  isProviderCapacityError,
  usableSnapshot,
} from "../server/provider-fallback.ts";

test("provider capacity errors are distinguished from normal turn failures", () => {
  assert.equal(isProviderCapacityError("You've hit your usage limit. Try again at 12:17 PM."), true);
  assert.equal(isProviderCapacityError("RESOURCE_EXHAUSTED: quota exceeded"), true);
  assert.equal(isProviderCapacityError("429 too many requests"), true);
  assert.equal(isProviderCapacityError("permission denied"), false);
  assert.equal(isProviderCapacityError("maximum context length exceeded"), false);
  assert.ok(CAPACITY_COOLDOWN_MS >= 60_000);
});

test("fallback only treats authenticated available engines as usable", () => {
  assert.equal(usableSnapshot({ state: "available", version: "x", authenticated: true }), true);
  assert.equal(usableSnapshot({ state: "available", version: "x" }), true);
  assert.equal(usableSnapshot({ state: "available", version: "x", authenticated: false }), false);
  assert.equal(usableSnapshot({ state: "unavailable", reason: "missing" }), false);
});

test("Codex fallback order starts with Gemini CLI", () => {
  assert.deepEqual(fallbackOrder("codex"), ["gemini_cli"]);
  assert.deepEqual(fallbackOrder("gemini_cli"), []);
});
