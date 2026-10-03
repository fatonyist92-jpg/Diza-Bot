import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";
import { startHarness } from "./helpers/server.ts";

function mockImagine() {
  const seen: any[] = [];
  const server = createServer(async (req, res) => {
    let body = "";
    for await (const chunk of req) body += chunk;
    seen.push({ method: req.method, url: req.url, body });
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ jobId: "should-not-be-called", status: "completed", outputs: [] }));
  });
  return new Promise<{ url: string; seen: any[]; close(): Promise<void> }>((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      resolve({
        url: `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`,
        seen,
        close: () => new Promise((done) => server.close(() => done())),
      });
    });
  });
}

test("Imagine API stays disabled even when a bridge URL is configured", async () => {
  const bridge = await mockImagine();
  const h = await startHarness({ DIZA_IMAGINE_URL: bridge.url });
  try {
    const bots = await h.json("/api/bots?messages=0");
    const bot = bots.bots[0];
    const response = await h.fetch("/api/imagine/jobs", {
      method: "POST",
      body: JSON.stringify({
        botId: bot.id,
        taskId: bot.activeTaskId,
        operation: "image-generate",
        prompt: "cat astronaut",
      }),
    });
    assert.equal(response.status, 404);
    const body = await response.json();
    assert.match(String(body.error ?? ""), /temporarily disabled/i);
    await new Promise((resolve) => setTimeout(resolve, 80));
    assert.equal(bridge.seen.length, 0);
  } finally {
    await h.stop();
    await bridge.close();
  }
});

test("all direct Imagine paths fail closed while the feature is dormant", async () => {
  const h = await startHarness();
  try {
    for (const [method, path] of [
      ["GET", "/api/imagine/jobs/example"],
      ["GET", "/api/imagine/assets/example"],
      ["GET", "/api/imagine/assets/example/content"],
    ] as const) {
      const response = await h.fetch(path, { method });
      assert.equal(response.status, 404, `${method} ${path}`);
      const body = await response.json();
      assert.match(String(body.error ?? ""), /temporarily disabled/i);
    }
  } finally {
    await h.stop();
  }
});
