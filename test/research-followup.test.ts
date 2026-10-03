import test from "node:test";
import assert from "node:assert/strict";
import { assembleTranscript } from "../server/context.ts";

test("research links stay in lane transcript for a follow-up turn", () => {
  const turns = [
    { role: "user" as const, text: "What changed today?" },
    {
      role: "assistant" as const,
      text: "The release changed today. [Primary docs](https://example.com/release) [Independent report](https://news.example.org/report)",
    },
    { role: "user" as const, text: "Compare the second source with the first." },
  ];
  const built = assembleTranscript(turns, null, 20_000);
  assert.equal(built.dropped, 0);
  assert.equal(built.turns.length, 2);
  assert.match(built.turns[1].text, /https:\/\/example\.com\/release/);
  assert.match(built.turns[1].text, /https:\/\/news\.example\.org\/report/);
});
