import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

test("camera controls are capture-only and pathless files use persisted upload", () => {
  const composer = readFileSync(new URL("../src/components/Composer.tsx", import.meta.url), "utf8");
  assert.match(composer, /accept="image\/\*"[\s\S]*capture="environment"/);
  assert.match(composer, /accept="video\/\*"[\s\S]*capture="environment"/);
  assert.match(composer, /uploadAttachment: uploadStoredAttachment/);
  assert.doesNotMatch(composer, /getUserMedia|srcObject|MediaStream/);
});

test("failed send keeps the draft until the server accepts it", () => {
  const composer = readFileSync(new URL("../src/components/Composer.tsx", import.meta.url), "utf8");
  const store = readFileSync(new URL("../src/state/store.tsx", import.meta.url), "utf8");
  assert.match(composer, /onAccepted:[\s\S]*setAttachments\(\[\]\)/);
  const failedStart = composer.indexOf("onFailed:");
  assert.ok(failedStart >= 0, "Composer has no onFailed callback");
  const failedEnd = composer.indexOf("\n      },", failedStart);
  assert.ok(failedEnd > failedStart, "Composer onFailed callback could not be isolated");
  const failedBlock = composer.slice(failedStart, failedEnd);
  assert.match(failedBlock, /setSubmitting\(false\)/);
  assert.match(failedBlock, /setAttachNotice\(/);
  assert.doesNotMatch(failedBlock, /setAttachments\(\[\]\)/, "failed send must keep attachments");
  assert.match(store, /\.then\(\(\) => action\.onAccepted\?\.\(\)\)/);
  assert.match(store, /action\.onFailed\?\.\(message\)/);
});
