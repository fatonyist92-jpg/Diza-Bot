import test from "node:test";
import assert from "node:assert/strict";

import { FREE_ONLY_SPEECH, listVoices, parseBotVoice, speak, speechConfigured } from "../server/speech.ts";

const cfg = { speech: { openaiKey: "paid-key", elevenlabsKey: "paid-key" } } as any;

test("FREE_ONLY speech never advertises paid vendors", async () => {
  assert.equal(FREE_ONLY_SPEECH, true);
  assert.deepEqual(speechConfigured(cfg), { elevenlabs: false, openai: false });
  assert.deepEqual(await listVoices(cfg), []);
});

test("system voice is a valid portable bot voice", () => {
  assert.deepEqual(parseBotVoice({ provider: "system", id: "device.voice", name: "Device Voice" }), {
    provider: "system",
    id: "device.voice",
    name: "Device Voice",
  });
});

test("legacy paid speech cannot make a network request in FREE_ONLY mode", async () => {
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = (async () => {
    calls += 1;
    throw new Error("network should not be reached");
  }) as typeof fetch;
  try {
    await assert.rejects(
      speak(cfg, { provider: "openai", id: "nova" }, "hello"),
      /paid speech providers are disabled by FREE_ONLY mode/,
    );
    await assert.rejects(
      speak(cfg, { provider: "elevenlabs", id: "legacy" }, "hello"),
      /paid speech providers are disabled by FREE_ONLY mode/,
    );
    assert.equal(calls, 0);
  } finally {
    globalThis.fetch = original;
  }
});
