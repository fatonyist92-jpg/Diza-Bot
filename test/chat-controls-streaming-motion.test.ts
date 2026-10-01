import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path: string) => readFileSync(path, "utf8");

test("turns no longer have the old 120-second Codex/watch wait cap", () => {
  const codex = read("server/drivers/codex.ts");
  const server = read("server/index.ts");
  assert.doesNotMatch(codex, /TURN_WATCHDOG_MS\s*=\s*120_000/);
  assert.doesNotMatch(codex, /within 120 seconds/);
  assert.doesNotMatch(server, /waitForLaneIdle\([^)]*120_000/);
  assert.doesNotMatch(server, /waitForIdle\([^)]*120_000/);
});

test("Stop targets the visible task and Codex settles immediately", () => {
  const composer = read("src/components/Composer.tsx");
  const chat = read("src/components/ChatView.tsx");
  const reducer = read("src/state/reducer.ts");
  const store = read("src/state/store.tsx");
  const server = read("server/index.ts");
  const codex = read("server/drivers/codex.ts");

  assert.match(reducer, /type: "interrupt"; botId: string; taskId\?: string/);
  assert.match(composer, /type: "interrupt", botId: bot\.id, taskId: bot\.threadId/);
  assert.match(chat, /type: "interrupt", botId: bot\.id, taskId: bot\.threadId/);
  assert.match(store, /JSON\.stringify\(action\.taskId \? \{ taskId: action\.taskId \} : \{\}\)/);
  assert.match(server, /stopping: true, taskId: laneId/);
  assert.match(server, /adapter\.hasSession\?\.\(laneId\)/);
  assert.match(codex, /const interrupt = \(\) => finish\(false, "interrupted"\)/);
  assert.match(codex, /interruptTurn: async \(threadId\) => running\.get\(threadId\)\?\.interrupt\(\)/);
});

test("mobile bot bubble exposes only the requested quick actions", () => {
  const chat = read("src/components/ChatView.tsx");
  assert.match(chat, /mobileActions/);
  assert.match(chat, />\s*Balas\s*<\/button>/);
  assert.match(chat, /mobileCopied \? "Tersalin" : "Salin"/);
  assert.match(chat, />\s*Hapus\s*<\/button>/);
  assert.match(chat, /max-width: 639px/);
});

test("assistant replies use a progressive stream pump without duplicate final bubble", () => {
  const store = read("src/state/store.tsx");
  const chat = read("src/components/ChatView.tsx");
  assert.match(store, /const streamPumps = new Map/);
  assert.match(store, /enqueueStream\(event\.threadId, event\.delta\)/);
  assert.match(store, /finishStream\(event\.threadId\)/);
  assert.match(store, /setTimeout\(step, 20\)/);
  assert.match(chat, /if \(streaming && fresh && m\.role === "bot" && m\.kind === "text"\) return null/);
});

test("top-level mobile navigation uses JavaScript view transitions with reduced-motion fallback", () => {
  const app = read("src/App.tsx");
  const css = read("src/styles.css");
  assert.match(app, /startViewTransition/);
  assert.match(app, /flushSync\(update\)/);
  assert.match(app, /prefers-reduced-motion: reduce/);
  assert.match(css, /::view-transition-old\(root\)/);
  assert.match(css, /::view-transition-new\(root\)/);
  assert.match(css, /@keyframes ui-view-in/);
});
