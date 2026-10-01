import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const adapter = fs.readFileSync("api/index.mjs", "utf8");
const server = fs.readFileSync("server/index.ts", "utf8");
const oauth = fs.readFileSync("server/oauth.ts", "utf8");
const client = fs.readFileSync("src/state/store.tsx", "utf8");
const vercel = JSON.parse(fs.readFileSync("vercel.json", "utf8"));

test("Vercel adapter fails closed until PostgreSQL restore is ready", () => {
  assert.match(adapter, /initializeNeonPersistence\(\)/);
  assert.match(adapter, /!persistence\.enabled \|\| !persistence\.ready/);
  assert.match(adapter, /saved data was not replaced/);
});

test("Vercel adapter validates the public origin before entering the loopback core", () => {
  assert.match(adapter, /hasAllowedPublicOrigin\(req\)/);
  assert.match(adapter, /new URL\(origin\)\.host === forwardedHost/);
  assert.match(adapter, /delete headers\.origin/);
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

test("serverless OpenRouter OAuth uses the public callback and durable one-use PKCE state", () => {
  assert.match(adapter, /VERCEL_PROJECT_PRODUCTION_URL/);
  assert.match(server, /DIZA_PUBLIC_ORIGIN/);
  assert.match(oauth, /persistPending\(state, entry\)/);
  assert.match(oauth, /pending\.get\(state\) \?\? restorePending\(state\)/);
  assert.match(oauth, /removePending\(state\)/);
  assert.match(adapter, /oauthCallback \|\|/);
});

test("Vercel stays on Hobby-compatible limits and routes only API through the function", () => {
  assert.equal(vercel.functions["api/index.mjs"].maxDuration, 300);
  assert.equal(vercel.outputDirectory, "dist");
  assert.ok(vercel.rewrites.some((rule: { source: string }) => rule.source === "/api/:path*"));
});
