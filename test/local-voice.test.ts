import test from "node:test";
import assert from "node:assert/strict";

import { listSystemVoices, spokenText, systemSpeechAvailable } from "../src/lib/localVoice.ts";

test("local voice module degrades safely outside a browser", () => {
  assert.equal(systemSpeechAvailable(), false);
  assert.deepEqual(listSystemVoices(), []);
});

test("spoken text removes visual markup and URLs", () => {
  const text = spokenText("## Result\n- **Done** ✅\nSee [report](https://example.com) and `12%`.");
  assert.match(text, /Result/);
  assert.match(text, /Done/);
  assert.match(text, /report/);
  assert.match(text, /12%/);
  assert.equal(text.includes("https://"), false);
  assert.equal(text.includes("**"), false);
});
