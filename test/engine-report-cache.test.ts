import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const source = fs.readFileSync("server/index.ts", "utf8");

test("Engine API coalesces duplicate registry probes on hosted runtimes", () => {
  assert.match(source, /const ENGINE_REPORT_TTL_MS = 10_000/);
  assert.match(source, /let engineReportInFlight: Promise<EngineReport> \| null = null/);
  assert.match(source, /if \(engineReportInFlight\) return engineReportInFlight/);
  assert.match(source, /engineReportCache = \{ value, expiresAt: Date\.now\(\) \+ ENGINE_REPORT_TTL_MS \}/);
  assert.match(source, /instances: await engineReports\(\)/);
  assert.match(source, /async function providerCatalog\(\)[\s\S]*?const described = await engineReports\(\)/);
});

test("Engine report cache is invalidated when provider/auth state changes", () => {
  assert.match(source, /async function reloadProviders\(\)[\s\S]*?invalidateEngineReports\(\)/);
  assert.match(source, /codexLoginStatus\(\)[\s\S]*?status\.status === "connected"\) invalidateEngineReports\(\)/);
  assert.match(source, /grokLoginStatus\(\)[\s\S]*?status\.status === "connected"\) invalidateEngineReports\(\)/);
});
