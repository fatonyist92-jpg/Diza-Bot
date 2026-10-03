import assert from "node:assert/strict";
import childProcess from "node:child_process";
import { EventEmitter } from "node:events";
import { syncBuiltinESMExports } from "node:module";
import { PassThrough, Writable } from "node:stream";
import { setImmediate } from "node:timers/promises";
import { test } from "node:test";

import { CodexDriver } from "../server/drivers/codex.ts";

function fakePeer(onRequest?: (frame: any, stdout: PassThrough) => void) {
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
          const result = frame.method === "thread/start" ? { thread: { id: "summary-thread" } } : {};
          queueMicrotask(() => {
            stdout.write(JSON.stringify({ id: frame.id, result }) + "\n");
            onRequest?.(frame, stdout);
          });
        }
        done();
      },
    }),
  });
  return { peer, frames, stdout };
}

test("Codex can generate one-shot text for context compaction", async (t) => {
  const peers: ReturnType<typeof fakePeer>[] = [];
  t.mock.method(childProcess, "spawn", () => {
    const made = fakePeer((frame, stdout) => {
      if (frame.method !== "turn/start") return;
      stdout.write(JSON.stringify({ method: "item/agentMessage/delta", params: { delta: "ringkasan " } }) + "\n");
      stdout.write(JSON.stringify({ method: "item/completed", params: { item: { type: "agentMessage", text: "ringkasan final" } } }) + "\n");
      stdout.write(JSON.stringify({ method: "turn/completed", params: { turn: { status: "completed" } } }) + "\n");
    });
    peers.push(made);
    return made.peer as any;
  });
  syncBuiltinESMExports();
  t.after(() => {
    t.mock.restoreAll();
    syncBuiltinESMExports();
  });

  const instance = await CodexDriver.create({
    instanceId: "codex", displayName: "Codex", enabled: true, environment: {},
    config: { cli: "fake-codex", fullAuto: false },
  });

  assert.equal(typeof instance.generateText, "function");
  assert.equal(await instance.generateText!("summarise this"), "ringkasan final");
  const start = peers[0].frames.find((frame) => frame.method === "thread/start");
  assert.equal(start.params.ephemeral, true);
  assert.equal(start.params.approvalPolicy, "never");
  await instance.dispose();
});

test("failed Codex turn emits a visible runtime error before completion", async (t) => {
  let peer!: ReturnType<typeof fakePeer>;
  t.mock.method(childProcess, "spawn", () => {
    peer = fakePeer();
    return peer.peer as any;
  });
  syncBuiltinESMExports();
  t.after(() => {
    t.mock.restoreAll();
    syncBuiltinESMExports();
  });

  const instance = await CodexDriver.create({
    instanceId: "codex", displayName: "Codex", enabled: true, environment: {},
    config: { cli: "fake-codex", fullAuto: false },
  });
  const events: any[] = [];
  instance.adapter.onEvent((event) => events.push(event));
  await instance.adapter.sendTurn({ threadId: "lane", text: "test" });
  await setImmediate();
  peer.stdout.write(JSON.stringify({
    method: "turn/completed",
    params: { turn: { status: "failed", error: { message: "maximum context length exceeded" } } },
  }) + "\n");
  await setImmediate();

  assert.ok(events.some((e) => e.type === "runtime.error" && /maximum context length/.test(e.message)));
  assert.ok(events.some((e) => e.type === "turn.completed" && e.ok === false));
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
  assert.doesNotMatch(store, /resetTaskSession[\s\S]{0,500}this\.messages\.delete/);
});

test("full provider-side context triggers preflight compaction even when visible transcript still fits", async () => {
  const { readFileSync } = await import("node:fs");
  const server = readFileSync("server/index.ts", "utf8");
  assert.match(server, /const providerSessionFull =[\s\S]{0,300}task\.lastInput[\s\S]{0,300}shouldCompact\(task\.lastInput/);
  assert.match(server, /if \(!blok && \(built\.dropped > 0 \|\| providerSessionFull\)\)/);
  assert.match(server, /foldContext\(bot\.id, task\.id, providerSessionFull\)/);
});
