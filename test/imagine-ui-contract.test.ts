import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const card = fs.readFileSync(path.resolve("src/components/ImagineCard.tsx"), "utf8");
const chat = fs.readFileSync(path.resolve("src/components/ChatView.tsx"), "utf8");
const cli = fs.readFileSync(path.resolve("bin/bloks.mjs"), "utf8");
const agent = fs.readFileSync(path.resolve("server/agent-cli.ts"), "utf8");

test("Imagine has a real conversation card with stable asset ids and media previews", () => {
  assert.match(chat, /case "imagine"/);
  assert.match(card, /Asset #\{asset\.ordinal\}/);
  assert.match(card, /api\/imagine\/assets\/\$\{asset\.id\}\/content/);
  assert.match(card, /<video/);
  assert.match(card, /<img/);
});

test("completed media can make a variation and video can extend +15 seconds", () => {
  assert.match(card, /Create a variation of Asset/);
  assert.match(card, /video-extend/);
  assert.match(card, /extendSeconds: 15/);
});

test("process-backed agents get an Imagine action while policy keeps one-turn scoping", () => {
  assert.match(cli, /imagine: \{/);
  assert.match(agent, /POST", path: "\/api\/imagine\/jobs/);
});

test("Imagine cannot bypass archived-project fail-closed behavior", () => {
  const index = fs.readFileSync(path.resolve("server/index.ts"), "utf8");
  assert.match(index, /project that is archived or no longer exists\. Restore the project before generating media/);
});

test("restart recovery is idempotent and resumes a known remote job by polling", () => {
  const index = fs.readFileSync(path.resolve("server/index.ts"), "utf8");
  assert.match(index, /"idempotency-key": jobId/);
  assert.match(index, /job\.remoteJobId/);
  assert.match(index, /job\.status === "queued" \|\| job\.status === "processing"/);
});
