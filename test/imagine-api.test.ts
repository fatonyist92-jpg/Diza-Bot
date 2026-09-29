import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";
import { startHarness } from "./helpers/server.ts";

const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";

function mockImagine() {
  const seen: any[] = [];
  const server = createServer(async (req, res) => {
    let body = "";
    for await (const chunk of req) body += chunk;
    if (req.method === "POST" && req.url === "/jobs") {
      const parsed = JSON.parse(body || "{}");
      parsed._idempotencyKey = req.headers["idempotency-key"];
      seen.push(parsed);
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({
        jobId: `remote-${parsed.jobId}`,
        status: "completed",
        progress: 100,
        outputs: [{ mime: "image/png", name: "result.png", dataBase64: PNG, continuity: parsed.continuity }],
      }));
      return;
    }
    res.writeHead(404, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "nope" }));
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

test("explicit image request temporarily hands off to ChatGPT without calling the Imagine bridge", async () => {
  const imagine = await mockImagine();
  const h = await startHarness({ DIZA_IMAGINE_URL: imagine.url });
  try {
    const bots = await h.json("/api/bots?messages=0");
    const bot = bots.bots[0];
    const sent = await h.fetch(`/api/bots/${bot.id}/messages`, {
      method: "POST", body: JSON.stringify({ text: "Bikin gambar kucing astronaut" }),
    });
    assert.equal(sent.status, 202);
    const accepted = await sent.json();
    assert.equal(accepted.imagineTemporary, "image-generate");
    assert.equal(accepted.imagineJobId, undefined);
    await new Promise((r) => setTimeout(r, 100));
    assert.equal(imagine.seen.length, 0);
  } finally {
    await h.stop();
    await imagine.close();
  }
});

test("project-scoped temporary image handoff creates no cross-project asset", async () => {
  const bridge = await mockImagine();
  const h = await startHarness({ DIZA_IMAGINE_URL: bridge.url });
  try {
    const bots = await h.json("/api/bots?messages=0");
    const bot = bots.bots[0];
    const p1 = (await (await h.fetch("/api/projects", { method: "POST", body: JSON.stringify({ name: "P1", memberIds: [bot.id] }) })).json()).project;
    const p2 = (await (await h.fetch("/api/projects", { method: "POST", body: JSON.stringify({ name: "P2", memberIds: [bot.id] }) })).json()).project;
    await h.fetch(`/api/bots/${bot.id}/tasks`, { method: "POST", body: JSON.stringify({ title: "P1 media", projectId: p1.id }) });
    const sent = await h.fetch(`/api/bots/${bot.id}/messages`, { method: "POST", body: JSON.stringify({ text: "Bikin gambar produk warna biru" }) });
    const accepted = await sent.json();
    assert.equal(accepted.imagineTemporary, "image-generate");
    assert.equal(bridge.seen.length, 0);
    const projects = (await h.json("/api/projects")).projects;
    assert.equal(projects.find((p: any) => p.id === p1.id).assets?.length ?? 0, 0);
    assert.equal(projects.find((p: any) => p.id === p2.id).assets?.length ?? 0, 0);
  } finally {
    await h.stop();
    await bridge.close();
  }
});
