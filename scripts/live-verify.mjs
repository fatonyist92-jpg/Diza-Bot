import assert from "node:assert/strict";
import fs from "node:fs";
import { chromium } from "playwright-core";

const base = String(process.env.LIVE_URL ?? "").replace(/\/$/, "");
const token = String(process.env.VERIFIER_TOKEN ?? "");
assert.ok(/^https:\/\//.test(base), "LIVE_URL must be HTTPS");
assert.ok(token.length >= 32, "VERIFIER_TOKEN is missing");

const executablePath =
  process.env.CHROME_PATH ||
  ["/usr/bin/google-chrome", "/usr/bin/google-chrome-stable", "/usr/bin/chromium", "/usr/bin/chromium-browser"]
    .find((path) => fs.existsSync(path));
assert.ok(executablePath, "no Chrome/Chromium executable found on the runner");

const browser = await chromium.launch({ headless: true, executablePath, args: ["--no-sandbox"] });
const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
const page = await context.newPage();
const pageErrors = [];
page.on("pageerror", (error) => pageErrors.push(String(error)));

const jsonFetch = (path, init) =>
  page.evaluate(
    async ({ path, init }) => {
      const response = await fetch(path, init);
      let body = null;
      try { body = await response.json(); } catch {}
      return { status: response.status, body };
    },
    { path, init },
  );

try {
  await page.goto(`${base}/#access=${encodeURIComponent(token)}`, {
    waitUntil: "domcontentloaded",
    timeout: 60_000,
  });
  await page.waitForFunction(() => !location.hash.includes("access="), null, { timeout: 20_000 });

  assert.equal(await page.title(), "DIZA BOT");
  await page.waitForFunction(() => document.body.innerText.includes("DIZA"), null, { timeout: 20_000 });

  const cookies = await context.cookies(base);
  const auth = cookies.find((cookie) => cookie.name === "diza_pair");
  assert.ok(auth, "paired-device cookie was not set");
  assert.equal(auth.httpOnly, true);
  assert.equal(auth.secure, true);

  const health = await jsonFetch("/api/health");
  assert.equal(health.status, 200);
  assert.equal(health.body?.app, "bloks");

  const readiness = await jsonFetch("/api/readiness");
  assert.equal(readiness.status, 200);
  assert.ok(["ready", "degraded"].includes(readiness.body?.status));

  const manifest = await page.locator('link[rel="manifest"]').getAttribute("href");
  assert.ok(manifest, "PWA manifest link is missing");

  let botsResponse = await jsonFetch("/api/bots?messages=20");
  assert.equal(botsResponse.status, 200);
  const bot = botsResponse.body?.bots?.[0];
  assert.ok(bot?.id, "no seeded bot available");

  const imagineDisabled = await jsonFetch("/api/imagine/jobs", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      botId: bot.id,
      taskId: bot.activeTaskId,
      operation: "image-generate",
      prompt: "disabled route verification",
    }),
  });
  assert.equal(imagineDisabled.status, 404);
  assert.match(String(imagineDisabled.body?.error ?? ""), /temporarily disabled/i);

  botsResponse = await jsonFetch("/api/bots?messages=30");
  const before = new Set((botsResponse.body?.bots?.[0]?.messages ?? []).map((message) => message.id));
  const sent = await jsonFetch(`/api/bots/${bot.id}/messages`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ text: "Balas singkat dengan teks: DIZA LIVE OK" }),
  });
  assert.equal(sent.status, 202);

  let reply = null;
  const deadline = Date.now() + 150_000;
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 2000));
    const latest = await jsonFetch("/api/bots?messages=40");
    const found = latest.body?.bots?.[0];
    reply = (found?.messages ?? []).find(
      (message) => !before.has(message.id) && message.role === "bot" && message.kind === "text" && String(message.text ?? "").trim(),
    );
    const busy = (found?.tasks ?? []).some((task) => task.state === "working");
    if (reply && !busy) break;
  }
  assert.ok(reply?.text, "real AI provider produced no browser-visible reply");

  const sw = await page.evaluate(async () => {
    if (!("serviceWorker" in navigator)) return { supported: false };
    const registration = await Promise.race([
      navigator.serviceWorker.ready,
      new Promise((_, reject) => setTimeout(() => reject(new Error("service worker timeout")), 20_000)),
    ]);
    return { supported: true, scope: registration.scope };
  });
  assert.equal(sw.supported, true);
  assert.ok(sw.scope.startsWith(base));

  await page.reload({ waitUntil: "domcontentloaded", timeout: 60_000 });
  await page.waitForFunction(() => navigator.serviceWorker?.controller !== null, null, { timeout: 20_000 });
  await context.setOffline(true);
  await page.reload({ waitUntil: "domcontentloaded", timeout: 20_000 });
  assert.equal(await page.title(), "DIZA BOT");
  assert.match(await page.locator("body").innerText(), /DIZA/i);
  await context.setOffline(false);

  assert.deepEqual(pageErrors, [], `browser page errors: ${pageErrors.join(" | ")}`);
  console.log("LIVE_VERIFY_PASS", JSON.stringify({
    title: await page.title(),
    health: health.body?.status ?? "ok",
    readiness: readiness.body?.status,
    providerReply: String(reply.text).slice(0, 120),
    pwa: true,
    mobileViewport: "390x844",
    imagineDormant: imagineDisabled.status === 404,
  }));
} finally {
  await context.setOffline(false).catch(() => {});
  await browser.close();
}
