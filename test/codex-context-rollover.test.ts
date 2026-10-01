import assert from "node:assert/strict";
import childProcess from "node:child_process";
import { EventEmitter } from "node:events";
import { syncBuiltinESMExports } from "node:module";
import { PassThrough, Writable } from "node:stream";
import { test } from "node:test";

import { CodexDriver } from "../server/drivers/codex.ts";

test("Codex can generate one-shot text for context compaction", async (t) => {
  const peers: Array<{ frames: any[]; stdout: PassThrough }> = [];

  t.mock.method(childProcess, "spawn", () => {
    const stdout = new PassThrough();
    const frames: any[] = [];
    const peer = Object.assign(new EventEmitter(), {
      pid: 4242,
      stdout,
      stderr: new PassThrough(),
      kill() {},
      stdin: new Writable({
        write(chunk, _encoding, done) {
          const frame = JSON.parse(String(chunk));
          frames.push(frame);
          if (frame.method && frame.id !== undefined) {
            const result =
              frame.method === "thread/start"
                ? { thread: { id: "summary-thread" } }
                : {};
            queueMicrotask(() => {
              stdout.write(JSON.stringify({ id: frame.id, result }) + "\n");
              if (frame.method === "turn/start") {
                stdout.write(JSON.stringify({
                  method: "item/agentMessage/delta",
                  params: { delta: "ringkasan " },
                }) + "\n");
                stdout.write(JSON.stringify({
                  method: "item/completed",
                  params: { item: { type: "agentMessage", text: "ringkasan final" } },
                }) + "\n");
                stdout.write(JSON.stringify({
                  method: "turn/completed",
                  params: { turn: { status: "completed" } },
                }) + "\n");
              }
            });
          }
          done();
        },
      }),
    });
    peers.push({ frames, stdout });
    return peer as any;
  });
  syncBuiltinESMExports();
  t.after(() => {
    t.mock.restoreAll();
    syncBuiltinESMExports();
  });

  const instance = await CodexDriver.create({
    instanceId: "codex",
    displayName: "Codex",
    enabled: true,
    environment: {},
    config: { cli: "fake-codex", fullAuto: false },
  });

  assert.equal(typeof instance.generateText, "function");
  const answer = await instance.generateText!("summarise this");
  assert.equal(answer, "ringkasan final");

  const start = peers[0].frames.find((frame) => frame.method === "thread/start");
  assert.equal(start.params.ephemeral, true);
  assert.equal(start.params.approvalPolicy, "never");
  const turn = peers[0].frames.find((frame) => frame.method === "turn/start");
  assert.equal(turn.params.threadId, "summary-thread");
  assert.equal(turn.params.input[0].text, "summarise this");

  await instance.dispose();
});

test("context compaction resets only the provider session and preserves chat history", async () => {
  const { readFileSync } = await import("node:fs");
  const server = readFileSync("server/index.ts", "utf8");
  const store = readFileSync("server/store.ts", "utf8");

  assert.match(server, /store\.resetTaskSession\(threadId, instance\.instanceId\)/);
  assert.match(server, /Session AI direfresh agar tetap bisa menjawab; history chat tetap tersimpan/);
  assert.match(store, /resetTaskSession\(threadId: string, instanceId: string\)/);
  assert.match(store, /delete found\.task\.resumeCursors\[instanceId\]/);
  assert.match(store, /delete found\.task\.lastInstanceId/);
  assert.doesNotMatch(store, /resetTaskSession[\s\S]{0,500}this\.messages\.delete/);
});


test("full provider-side context triggers preflight compaction even when visible transcript still fits", async () => {
  const { readFileSync } = await import("node:fs");
  const server = readFileSync("server/index.ts", "utf8");

  assert.match(server, /const providerSessionFull =[\s\S]{0,260}task\.lastInput[\s\S]{0,260}shouldCompact\(task\.lastInput/);
  assert.match(server, /if \(!blok && \(built\.dropped > 0 \|\| providerSessionFull\)\)/);
  assert.match(server, /foldContext\(bot\.id, task\.id, providerSessionFull\)/);
});
