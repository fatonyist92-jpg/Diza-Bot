import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
const index = fs.readFileSync(path.resolve("server/index.ts"), "utf8");
test("Imagine retry re-enters the validated creation path and only retries failed jobs", () => {
  assert.match(index, /old\.status !== "failed"/);
  assert.match(index, /createImagineJob\(\{[\s\S]*retryOf: old\.id/);
});
test("Imagine outputs are ingested through the Bab 8 attachment byte gate", () => {
  assert.match(index, /attachments\.storeAttachmentBytes\(bytes, output\.mime\)/);
  assert.match(index, /saved\.kind !== "image" && saved\.kind !== "video"/);
});

test("Imagine bridge rejects oversized encoded output before base64 allocation", () => {
  assert.match(index, /const outputLimit = attachments\.maxBytesFor\(output\.mime\)/);
  assert.match(index, /output\.dataBase64\.length > encodedLimit/);
});

test("normal dispatch and startup recovery cannot execute the same Imagine job concurrently", () => {
  assert.match(index, /const runningImagineJobs = new Set<string>\(\)/);
  assert.match(index, /if \(runningImagineJobs\.has\(jobId\)\) return/);
  assert.match(index, /runningImagineJobs\.delete\(jobId\)/);
});
