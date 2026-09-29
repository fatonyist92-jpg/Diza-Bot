import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const index = fs.readFileSync(path.resolve("server/index.ts"), "utf8");

test("legacy liveness contract stays unchanged and readiness is separate", () => {
  assert.match(index, /path === "\/api\/health"[\s\S]{0,220}app: "bloks", pid: process\.pid, static: Boolean\(STATIC_DIR\)/);
  assert.match(index, /path === "\/api\/readiness"/);
  assert.match(index, /engineStates: engineRows\.map/);
});

test("monitoring stores counts only, never provider error text", () => {
  assert.match(index, /failures\.record\("provider"\)/);
  assert.match(index, /failures\.record\("imagine"\)/);
  assert.doesNotMatch(index, /failures\.record\("provider",\s*event\.message/);
});
