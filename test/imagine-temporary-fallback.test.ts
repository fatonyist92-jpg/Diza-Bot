import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const server = fs.readFileSync("server/index.ts", "utf8");

test("temporary image fallback is an explicit ChatGPT handoff, not a fake Imagine job", () => {
  assert.match(server, /DIZA Imagine untuk gambar sementara dialihkan ke ChatGPT/);
  assert.match(server, /https:\/\/chatgpt\.com\//);
  assert.match(server, /image-generate.*image-edit.*variation/s);
  assert.match(server, /publishTemporaryImagineNotice\(lane\.id, detected\.operation\)/);
});

test("temporary video fallback uses the locked unavailable copy and never queues a video job", () => {
  assert.match(server, /Maaf, layanan pembuatan video sementara belum tersedia\./);
  assert.match(server, /image-to-video.*text-to-video.*video-extend/s);
  assert.match(server, /if \(temporary\) return json\(res, 503/);
});

test("separate Imagine bridge implementation remains present for future restoration", () => {
  assert.match(server, /function createImagineJob/);
  assert.match(server, /function imagineBridgeUrl/);
  assert.match(server, /async function runImagineJob/);
});
