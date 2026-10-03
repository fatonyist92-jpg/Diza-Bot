import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import { openAiCompatDriver } from "../server/drivers/openai-compat.ts";
import type { ProviderSpec } from "../server/providers.ts";

async function listen() {
  let seenTools: string[] = [];
  const server = createServer(async (req, res) => {
    if (req.method === "GET" && req.url === "/models") {
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ data: [{ id: "test-model" }] }));
      return;
    }
    if (req.method === "POST" && req.url === "/chat/completions") {
      let body = "";
      for await (const chunk of req) body += chunk;
      const json = JSON.parse(body || "{}");
      seenTools = Array.isArray(json.tools)
        ? json.tools.map((tool: any) => tool?.function?.name).filter(Boolean)
        : [];
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({
        choices: [{ message: { role: "assistant", content: "done" } }],
        usage: { prompt_tokens: 1, completion_tokens: 1 },
      }));
      return;
    }
    res.statusCode = 404;
    res.end("no");
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("no test port");
  return { server, url: `http://127.0.0.1:${address.port}`, tools: () => seenTools };
}

test("OpenAI-compatible API turns receive the app-owned browser tools when granted", async () => {
  const fake = await listen();
  const spec: ProviderSpec = {
    kind: "test-compat",
    name: "Test Compat",
    url: fake.url,
    auth: "none",
    keyHint: "none",
    docsUrl: "https://example.com/docs",
    tools: true,
    models: { default: "test-model", options: [{ id: "test-model", label: "Test Model" }] },
  };
  const driver = openAiCompatDriver(spec);
  const instance = await driver.create({
    instanceId: "test-instance",
    displayName: "Test",
    environment: {},
    enabled: true,
    config: { url: fake.url, apiKeyEnv: "TEST_KEY" },
  });
  try {
    const completed = new Promise<void>((resolve, reject) => {
      const off = instance.adapter.onEvent((event) => {
        if (event.type === "runtime.error") {
          off();
          reject(new Error(event.message));
        }
        if (event.type === "turn.completed") {
          off();
          event.ok ? resolve() : reject(new Error(event.stopReason ?? "turn failed"));
        }
      });
    });
    await instance.adapter.sendTurn({
      threadId: "research-thread",
      text: "search the web",
      model: "test-model",
      system: "use browser",
      integrations: {
        browser: { profileDir: "/tmp/bloks-browser-api-research-test", port: 19998 },
      },
    });
    await completed;
    const names = new Set(fake.tools());
    assert.equal(names.has("browser_open"), true);
    assert.equal(names.has("browser_read"), true);
    assert.equal(names.has("browser_snapshot"), true);
  } finally {
    await instance.dispose();
    fake.server.close();
    await once(fake.server, "close").catch(() => {});
  }
});

test("a browser tool error is marked failed but the API turn can recover and finish", async () => {
  let calls = 0;
  const server = createServer(async (req, res) => {
    if (req.method === "GET" && req.url === "/models") {
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ data: [{ id: "test-model" }] }));
      return;
    }
    if (req.method === "POST" && req.url === "/chat/completions") {
      let body = "";
      for await (const chunk of req) body += chunk;
      JSON.parse(body || "{}");
      calls += 1;
      res.setHeader("content-type", "application/json");
      if (calls === 1) {
        res.end(JSON.stringify({
          choices: [{
            message: {
              role: "assistant",
              content: null,
              tool_calls: [{
                id: "browser-call-1",
                type: "function",
                function: { name: "browser_click", arguments: JSON.stringify({ ref: "!" }) },
              }],
            },
          }],
          usage: { prompt_tokens: 1, completion_tokens: 1 },
        }));
      } else {
        res.end(JSON.stringify({
          choices: [{ message: { role: "assistant", content: "Browser failed, so current verification was not possible." } }],
          usage: { prompt_tokens: 1, completion_tokens: 1 },
        }));
      }
      return;
    }
    res.statusCode = 404;
    res.end("no");
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("no test port");
  const url = `http://127.0.0.1:${address.port}`;
  const spec: ProviderSpec = {
    kind: "test-compat-failure",
    name: "Test Compat Failure",
    url,
    auth: "none",
    keyHint: "none",
    docsUrl: "https://example.com/docs",
    tools: true,
    models: { default: "test-model", options: [{ id: "test-model", label: "Test Model" }] },
  };
  const driver = openAiCompatDriver(spec);
  const instance = await driver.create({
    instanceId: "test-instance-failure",
    displayName: "Test Failure",
    environment: {},
    enabled: true,
    config: { url, apiKeyEnv: "TEST_KEY" },
  });
  const toolResults: boolean[] = [];
  let answer = "";
  try {
    const completed = new Promise<void>((resolve, reject) => {
      const off = instance.adapter.onEvent((event) => {
        if (event.type === "item.completed" && event.itemType === "tool") toolResults.push(event.ok);
        if (event.type === "item.completed" && event.itemType === "assistant_text") answer = event.text;
        if (event.type === "runtime.error") {
          off();
          reject(new Error(event.message));
        }
        if (event.type === "turn.completed") {
          off();
          event.ok ? resolve() : reject(new Error(event.stopReason ?? "turn failed"));
        }
      });
    });
    await instance.adapter.sendTurn({
      threadId: "research-thread-failure",
      text: "verify something current",
      model: "test-model",
      integrations: {
        browser: { profileDir: "/tmp/bloks-browser-api-research-failure", port: 19997 },
      },
    });
    await completed;
    assert.deepEqual(toolResults, [false]);
    assert.match(answer, /verification was not possible/i);
    assert.equal(calls, 2);
  } finally {
    await instance.dispose();
    server.close();
    await once(server, "close").catch(() => {});
  }
});
