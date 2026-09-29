import assert from "node:assert/strict";
import { test } from "node:test";
import { composeDizaIdentity } from "../server/diza-identity.ts";

test("identity is provider independent", () => {
  const prompt = composeDizaIdentity({ name: "Diza", role: "assistant", instructions: "Be concise", userAbout: "Builds apps", preferences: "Bahasa Indonesia" });
  assert.match(prompt, /You are Diza/);
  assert.match(prompt, /provider changes/);
  assert.match(prompt, /Be concise/);
  assert.match(prompt, /Builds apps/);
  assert.match(prompt, /Bahasa Indonesia/);
  assert.doesNotMatch(prompt, /Gemini|Groq|OpenRouter|xAI/);
});

test("empty optional personalization does not leak placeholders", () => {
  const prompt = composeDizaIdentity({ name: "Diza" });
  assert.doesNotMatch(prompt, /undefined|null/);
});
