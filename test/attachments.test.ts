import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  attachmentBasename,
  composeOutgoing,
  fileAttachment,
  formatBytes,
  intakeFiles,
  isLongPaste,
  pasteAttachment,
  splitAttachments,
  videoAttachment,
  type ImageAttachment,
} from "../src/lib/attachments.ts";
import { extensionFor, kindFor, maxBytesFor, IMAGE_MAX_BYTES, VIDEO_MAX_BYTES } from "../server/attachments.ts";

const textFile = (name: string, contents: string) => ({ name, size: contents.length, type: "text/plain", text: async () => contents });

describe("isLongPaste", () => {
  test("short text is typing, long text is a chip", () => {
    assert.equal(isLongPaste("hello there"), false);
    assert.equal(isLongPaste("x".repeat(900)), true);
    assert.equal(isLongPaste(Array(12).fill("line").join("\n")), true);
  });
});

describe("intakeFiles", () => {
  const image = (name: string): ImageAttachment => ({ kind: "image", id: "i1", path: `/tmp/${name}`, name, bytes: 10, mime: "image/png" });

  test("images upload while unsupported desktop formats may keep their explicit path", async () => {
    const files = [
      { name: "shot.png", size: 10, type: "image/png", text: async () => "" },
      { name: "archive.bin", size: 12, type: "application/octet-stream", text: async () => "" },
    ];
    const { attachments, refused } = await intakeFiles(files, {
      pathOf: (f) => (f.name === "archive.bin" ? "/Users/h/archive.bin" : ""),
      uploadAttachment: async (f) => image(f.name),
    });
    assert.equal(refused, null);
    assert.deepEqual(attachments.map((a) => a.kind), ["image", "file"]);
  });

  test("pathless text stays inline", async () => {
    const { attachments } = await intakeFiles([textFile("snippet.txt", "line one\nline two")], { pathOf: () => "", uploadAttachment: async () => null });
    assert.equal(attachments[0]?.kind, "paste");
  });

  test("pathless video can upload for web/PWA", async () => {
    const video = { name: "clip.mp4", size: 5, type: "video/mp4", text: async () => "" };
    const { attachments, refused } = await intakeFiles([video], {
      pathOf: () => "",
      uploadAttachment: async () => videoAttachment("clip.mp4", "/saved/clip.mp4", 5, "video/mp4"),
    });
    assert.equal(refused, null);
    assert.equal(attachments[0]?.kind, "video");
  });

  test("unsupported file is refused explicitly", async () => {
    const { attachments, refused } = await intakeFiles([{ name: "app.exe", size: 5, type: "application/x-msdownload", text: async () => "" }], { pathOf: () => "", uploadAttachment: async () => null });
    assert.equal(attachments.length, 0);
    assert.match(refused ?? "", /not supported/);
  });
});

describe("composeOutgoing and splitAttachments", () => {
  test("metadata round-trips and old text remains visible", () => {
    const prompt = composeOutgoing("look at this", [
      fileAttachment("a.ts", "/src/a.ts", 10, "text/plain"),
      videoAttachment("clip.mp4", "/src/clip.mp4", 12, "video/mp4"),
      pasteAttachment("some\npasted\ntext"),
    ]);
    assert.match(prompt, /<attached-file path="\/src\/a\.ts" name="a\.ts" mime="text\/plain" \/>/);
    assert.match(prompt, /<attached-video/);
    const split = splitAttachments(prompt);
    assert.equal(split.files[0]?.name, "a.ts");
    assert.equal(split.videos[0]?.name, "clip.mp4");
    assert.match(split.display, /pasted-text/);
  });

  test("hostile attributes remain contained", () => {
    const prompt = composeOutgoing("", [fileAttachment('x"><evil>', '/tmp/a"><evil>.txt', 1)]);
    assert.ok(!prompt.includes('path="/tmp/a"><evil>'));
    assert.equal(splitAttachments(prompt).files[0]?.path, '/tmp/a"><evil>.txt');
  });

  test("legacy path-only tags remain readable", () => {
    const split = splitAttachments('here\n<attached-image path="/tmp/abc.png" />');
    assert.equal(split.display, "here");
    assert.equal(split.images[0]?.path, "/tmp/abc.png");
  });
});

describe("server MIME policy", () => {
  test("allow-list classifies image/video/document with caps", () => {
    assert.equal(extensionFor("image/png"), "png");
    assert.equal(kindFor("image/png"), "image");
    assert.equal(kindFor("video/mp4"), "video");
    assert.equal(extensionFor("application/pdf"), "pdf");
    assert.equal(kindFor("application/pdf"), "file");
    assert.equal(extensionFor("image/svg+xml"), null);
    assert.equal(maxBytesFor("image/jpeg"), IMAGE_MAX_BYTES);
    assert.equal(maxBytesFor("video/mp4"), VIDEO_MAX_BYTES);
  });
});

test("small display helpers stay stable", () => {
  assert.equal(attachmentBasename("C:\\att\\abc.png"), "abc.png");
  assert.equal(formatBytes(2048), "2.0 KB");
});
