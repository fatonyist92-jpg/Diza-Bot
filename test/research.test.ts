import test from "node:test";
import assert from "node:assert/strict";
import { extractResearchSources, researchInstruction } from "../server/research.ts";

test("research sources prefer markdown labels and deduplicate URLs", () => {
  const sources = extractResearchSources(
    "See [Primary docs](https://example.com/docs) and https://example.com/docs plus https://news.example.org/a.",
  );
  assert.equal(sources.length, 2);
  assert.deepEqual(sources[0], {
    url: "https://example.com/docs",
    title: "Primary docs",
    host: "example.com",
  });
  assert.equal(sources[1].host, "news.example.org");
});

test("research source extraction ignores unsafe or credential-bearing links", () => {
  const sources = extractResearchSources(
    "[local](file:///tmp/a) javascript:alert(1) https://user:secret@example.com/private",
  );
  assert.equal(sources.length, 0);
});

test("research instruction requires real linked evidence and admits unavailable web", () => {
  const hint = researchInstruction(true);
  assert.match(hint, /two independent sources/i);
  assert.match(hint, /Never invent a URL/i);
  assert.match(hint, /Synthesize rather than dumping snippets/i);
  assert.match(hint, /verification was not possible/i);
});
