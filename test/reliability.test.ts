import test from "node:test";
import assert from "node:assert/strict";
import { FailureWindow, reliabilitySnapshot } from "../server/reliability.ts";

test("readiness is healthy with no stalled work", () => {
  const snap = reliabilitySnapshot({
    uptimeSeconds: 12.4,
    bots: [{ tasks: [{ busy: true }, { busy: false }] }],
    imagineJobs: [{ status: "completed", updatedAt: 10 }],
    imagineConfigured: false,
    imagineEnabled: false,
    now: 1_000,
  });
  assert.equal(snap.status, "ready");
  assert.equal(snap.counts.busyTasks, 1);
  assert.deepEqual(snap.warnings, []);
});

test("enabled unconfigured Imagine is degraded without exposing its URL/token", () => {
  const snap = reliabilitySnapshot({
    uptimeSeconds: 1,
    bots: [],
    imagineJobs: [],
    imagineConfigured: false,
    imagineEnabled: true,
    now: 1_000,
  });
  assert.equal(snap.status, "degraded");
  assert.match(JSON.stringify(snap), /bridge is not configured/);
  assert.doesNotMatch(JSON.stringify(snap), /token|https?:\/\//i);
});

test("stalled queued/processing jobs degrade readiness", () => {
  const snap = reliabilitySnapshot({
    uptimeSeconds: 1,
    bots: [],
    imagineJobs: [
      { status: "queued", updatedAt: 0 },
      { status: "processing", updatedAt: 100 },
      { status: "failed", updatedAt: 0 },
    ],
    imagineConfigured: true,
    imagineEnabled: true,
    now: 21 * 60_000,
  });
  assert.equal(snap.status, "degraded");
  assert.equal(snap.imagine.stalledJobs, 2);
  assert.equal(snap.counts.imagineFailed, 1);
});

test("failure window is bounded, content-free and expires old events", () => {
  const window = new FailureWindow(1_000, 3);
  window.record("provider", 100);
  window.record("provider", 200);
  window.record("imagine", 300);
  window.record("provider", 400);
  const snap = window.snapshot(500);
  assert.equal(snap.total, 3);
  assert.deepEqual(snap.byArea, { provider: 2, imagine: 1 });
  assert.equal(window.snapshot(2_000).total, 0);
});
