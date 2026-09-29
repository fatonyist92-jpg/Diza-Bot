import test from "node:test";
import assert from "node:assert/strict";
import { assembleTranscript } from "../server/context.ts";

test("attachment tags stay in lane transcript so retry/follow-up keeps the same durable reference", () => {
  const tagged = 'inspect this\n<attached-file path="/safe/abc.pdf" name="report.pdf" mime="application/pdf" />';
  const built = assembleTranscript([
    { role: "user" as const, text: tagged },
    { role: "assistant" as const, text: "I can continue from that attachment." },
    { role: "user" as const, text: "Now focus on the second section." },
  ], null, 20_000);
  assert.equal(built.dropped, 0);
  assert.match(built.turns[0].text, /<attached-file/);
  assert.match(built.turns[0].text, /report\.pdf/);
});
