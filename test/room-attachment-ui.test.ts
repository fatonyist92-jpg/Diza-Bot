import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

test("room composer exposes the same Foto Kamera Video File attachment menu", () => {
  const room = readFileSync(new URL("../src/components/RoomView.tsx", import.meta.url), "utf8");
  assert.match(room, /\["Foto"/);
  assert.match(room, /\["Kamera"/);
  assert.match(room, /\["Video"/);
  assert.match(room, /\["File"/);
  assert.match(room, /type="file"[\s\S]*multiple/);
  assert.match(room, /uploadAttachment: uploadStoredAttachment/);
  assert.match(room, /composeOutgoing\(text, attachments\)/);
  assert.match(room, /disabled=\{!text\.trim\(\) && !attachments\.length\}/);
});

test("room bubbles lift attachment tags out instead of showing raw transport markup", () => {
  const room = readFileSync(new URL("../src/components/RoomView.tsx", import.meta.url), "utf8");
  assert.match(room, /function RoomUserText/);
  assert.match(room, /splitAttachments\(text\)/);
  assert.match(room, /attachmentBasename\(attachment\.path\)/);
});
