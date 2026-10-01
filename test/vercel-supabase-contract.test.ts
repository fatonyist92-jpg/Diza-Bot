import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const adapter = fs.readFileSync("api/index.mjs", "utf8");
const server = fs.readFileSync("server/index.ts", "utf8");
const client = fs.readFileSync("src/state/store.tsx", "utf8");
const vercel = JSON.parse(fs.readFileSync("vercel.json", "utf8"));

test("Vercel adapter fails closed until PostgreSQL restore is ready", () => {
  assert.match(adapter, /initializeNeonPersistence\(\)/);
  assert.match(adapter, /!persistence\.enabled \|\| !persistence\.ready/);
  assert.match(adapter, /saved data was not replaced/);
});

test("mutating requests sync before their streamed response completes", () => {
  const proxyAt = adapter.indexOf("await proxy(req, res, path)");
  const syncAt = adapter.indexOf("await persistence.sync(`vercel-");
  const endAt = adapter.indexOf("res.end();", syncAt);
  assert.ok(proxyAt >= 0 && syncAt > proxyAt && endAt > syncAt);
});

test("serverless chat carries existing runtime frames on its own request", () => {
  assert.match(server, /DIZA_SERVERLESS === "1"/);
  assert.match(server, /text\/event-stream/);
  assert.match(server, /sseClients\.add\(res\)/);
  assert.match(client, /accept: "text\/event-stream"/);
  assert.match(client, /type: "streamDelta"/);
  assert.match(client, /type: "messageAdded"/);
});

test("Vercel stays on Hobby-compatible limits and routes only API through the function", () => {
  assert.equal(vercel.functions["api/index.mjs"].maxDuration, 300);
  assert.equal(vercel.outputDirectory, "dist");
  assert.ok(vercel.rewrites.some((rule: { source: string }) => rule.source === "/api/:path*"));
});
