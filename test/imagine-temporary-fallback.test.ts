import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const server = fs.readFileSync("server/index.ts", "utf8");

test("normal image and video requests are not intercepted by Imagine", () => {
  assert.match(server, /const DIZA_IMAGINE_ACTIVE = false/);
  assert.match(server, /if \(DIZA_IMAGINE_ACTIVE\) \{[\s\S]*detectImagineRequest/);
  assert.match(server, /await startTurn\(bot\.id, text/);
  assert.doesNotMatch(server, /dialihkan ke ChatGPT/);
  assert.doesNotMatch(server, /layanan pembuatan video sementara belum tersedia/);
});

test("media work is explicitly routed through normal tools and web deliverables", () => {
  assert.match(server, /Media work: DIZA Imagine is temporarily disabled/);
  assert.match(server, /browser, computer, web, or other connected tools/);
  assert.match(server, /final image or video file/);
  assert.match(server, /HTML, PDF, images, video, CSV/);
});

test("Imagine cannot restart itself or expose API routes while dormant", () => {
  assert.match(server, /if \(DIZA_IMAGINE_ACTIVE\) \{[\s\S]*for \(const job of imagine\.jobs\)/);
  assert.match(server, /!DIZA_IMAGINE_ACTIVE && path\.startsWith\("\/api\/imagine"\)/);
  assert.match(server, /DIZA Imagine is temporarily disabled\. Use normal chat media tools\./);
});

test("separate Imagine implementation remains present for future restoration", () => {
  assert.match(server, /function createImagineJob/);
  assert.match(server, /function imagineBridgeUrl/);
  assert.match(server, /async function runImagineJob/);
});
