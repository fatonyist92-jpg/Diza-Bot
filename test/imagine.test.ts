import assert from "node:assert/strict";
import { describe, test } from "node:test";
import fs from "node:fs";

import { detectImagineRequest, extractImagineDirectives, imagineContext, type ImagineAsset } from "../server/imagine.ts";

const asset = (id: string, kind: "image" | "video", createdAt: number): ImagineAsset => ({
  id, botId: "b1", taskId: "t1", kind, path: `/tmp/${id}`, mime: kind === "image" ? "image/png" : "video/mp4",
  name: id, createdAt, source: "imagine",
});

const assets = [asset("image-one", "image", 1), asset("image-two", "image", 2), asset("video-three", "video", 3)];

describe("provider-independent Imagine intent detection", () => {
  test("explicit image and text-to-video asks route without a model", () => {
    assert.equal(detectImagineRequest("Bikin gambar kucing", [])?.operation, "image-generate");
    const video = detectImagineRequest("Buat video kota malam 15 detik", []);
    assert.equal(video?.operation, "text-to-video");
    assert.equal(video?.continuity?.durationSeconds, 15);
  });

  test("stable ordinals resolve follow-ups to the exact asset", () => {
    const i2v = detectImagineRequest("Yang kedua bikin bergerak 12 detik", assets);
    assert.equal(i2v?.operation, "image-to-video");
    assert.deepEqual(i2v?.inputAssetIds, ["image-two"]);
    assert.equal(i2v?.continuity?.durationSeconds, 12);
  });

  test("extend binds to a video parent and defaults to +15 seconds", () => {
    const extend = detectImagineRequest("Lanjutkan video tadi", assets);
    assert.equal(extend?.operation, "video-extend");
    assert.equal(extend?.parentAssetId, "video-three");
    assert.equal(extend?.continuity?.extendSeconds, 15);
  });

  test("ambiguous ordinary chat is not hijacked", () => {
    assert.equal(detectImagineRequest("Menurut kamu gambar ini bagus?", assets), null);
    assert.equal(detectImagineRequest("Jelaskan cara kerja video codec", assets), null);
    assert.equal(detectImagineRequest("Buat analisis gambar ini", assets), null);
    assert.equal(detectImagineRequest("Buat deskripsi video tadi", assets), null);
  });
});

describe("API-model action directives", () => {
  test("directive is removed from visible prose and parsed as an action", () => {
    const parsed = extractImagineDirectives('Siap.\n```diza-imagine\n{"operation":"image-to-video","prompt":"walk toward camera","inputAssetIds":["image-two"],"parentAssetId":"image-two","continuity":{"durationSeconds":15}}\n```');
    assert.equal(parsed.text, "Siap.");
    assert.equal(parsed.directives.length, 1);
    assert.equal(parsed.directives[0]!.operation, "image-to-video");
    assert.deepEqual(parsed.directives[0]!.inputAssetIds, ["image-two"]);
  });
});

test("asset context exposes stable ids but says it is not long-term memory", () => {
  const text = imagineContext(assets);
  assert.match(text, /Asset #2: id=image-two/);
  assert.match(text, /not long-term memory/);
});

test("engine continuity is sanitized again when results are completed", () => {
  const source = fs.readFileSync(new URL("../server/imagine.ts", import.meta.url), "utf8");
  assert.match(source, /continuity: cleanContinuity\(\{ \.\.\.\(job\.continuity/);
});
