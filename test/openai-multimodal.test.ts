import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DATA_DIR } from "../server/config.ts";
import { openAiCompatDriver } from "../server/drivers/openai-compat.ts";
import type { ProviderSpec } from "../server/providers.ts";

async function fakeProvider() {
  let seen: any = null;
  const server = createServer(async (req, res) => {
    if (req.method === "GET" && req.url === "/models") {
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ data: [{ id: "test-model" }] }));
      return;
    }
    if (req.method === "POST" && req.url === "/chat/completions") {
      let body = "";
      for await (const chunk of req) body += chunk;
      seen = JSON.parse(body || "{}");
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ choices: [{ message: { role: "assistant", content: "done" } }], usage: { prompt_tokens: 1, completion_tokens: 1 } }));
      return;
    }
    res.statusCode = 404; res.end("no");
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("no port");
  return { server, url: `http://127.0.0.1:${address.port}`, seen: () => seen };
}

test("OpenAI-compatible provider receives app-owned image bytes as multimodal content", async () => {
  const dir = join(DATA_DIR, "attachments");
  mkdirSync(dir, { recursive: true });
  const path = join(dir, "33333333-3333-3333-3333-333333333333.png");
  writeFileSync(path, Buffer.from([137,80,78,71,13,10,26,10]));
  const fake = await fakeProvider();
  const spec: ProviderSpec = {
    kind: "test-mm", name: "Test MM", url: fake.url, auth: "none", keyHint: "none", docsUrl: "https://example.com",
    tools: true, models: { default: "test-model", options: [{ id: "test-model", label: "Test" }] },
  };
  const instance = await openAiCompatDriver(spec).create({ instanceId: "mm", displayName: "MM", environment: {}, enabled: true, config: { url: fake.url, apiKeyEnv: "NONE" } });
  try {
    const completed = new Promise<void>((resolve, reject) => {
      const off = instance.adapter.onEvent((event) => {
        if (event.type === "runtime.error") { off(); reject(new Error(event.message)); }
        if (event.type === "turn.completed") { off(); event.ok ? resolve() : reject(new Error(event.stopReason ?? "failed")); }
      });
    });
    await instance.adapter.sendTurn({ threadId: "mm-thread", model: "test-model", text: `describe\n<attached-image path="${path}" name="photo.png" mime="image/png" />` });
    await completed;
    const user = fake.seen().messages.find((m: any) => m.role === "user");
    assert.ok(Array.isArray(user.content));
    assert.equal(user.content[1].type, "image_url");
    assert.match(user.content[1].image_url.url, /^data:image\/png;base64,/);
  } finally {
    await instance.dispose();
    fake.server.close();
    await once(fake.server, "close").catch(() => {});
  }
});
