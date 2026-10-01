import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const html = fs.readFileSync("index.html", "utf8");
const manifest = JSON.parse(fs.readFileSync("public/manifest.webmanifest", "utf8"));
const sw = fs.readFileSync("public/sw.js", "utf8");
const main = fs.readFileSync("src/main.tsx", "utf8");
const pwa = fs.readFileSync("src/lib/pwa.ts", "utf8");
const server = fs.readFileSync("server/index.ts", "utf8");

test("DIZA web metadata and install manifest are wired", () => {
  assert.match(html, /<title>DIZA BOT<\/title>/);
  assert.match(html, /rel="manifest" href="\/manifest\.webmanifest"/);
  assert.equal(manifest.name, "DIZA BOT");
  assert.equal(manifest.display, "standalone");
  assert.equal(manifest.start_url, "/");
});

test("service worker keeps API live while caching fetched shell assets", () => {
  assert.match(sw, /url\.pathname\.startsWith\("\/api\/"\)/);
  assert.match(sw, /request\.method !== "GET"/);
  assert.match(sw, /request\.mode === "navigate"/);
  assert.match(sw, /cache\.put\(request, copy\)/);
});

test("PWA registration is additive and secure-context aware", () => {
  assert.match(main, /registerPwa\(\)/);
  assert.match(pwa, /"serviceWorker" in navigator/);
  assert.match(pwa, /location\.protocol !== "https:"/);
  assert.match(pwa, /document\.readyState === "complete"/);
  assert.match(pwa, /window\.addEventListener\("load", register/);
  assert.match(pwa, /\.catch\(\(\) =>/);
});

test("packaged static server serves manifest with the correct MIME type", () => {
  assert.match(server, /"\.webmanifest": "application\/manifest\+json"/);
});
