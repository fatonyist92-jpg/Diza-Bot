import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { simpleIndonesianText } from "../src/lib/uiLanguage.ts";

test("mobile chat removes the task strip area while desktop keeps it", () => {
  const chat = readFileSync(new URL("../src/components/ChatView.tsx", import.meta.url), "utf8");
  assert.match(chat, /className="hidden md:block"[\s\S]*<TaskStrip/);
});

test("mobile home follows the locked Obrolan Agen Ruang reference", () => {
  const home = readFileSync(new URL("../src/components/MobileChatHome.tsx", import.meta.url), "utf8");
  const app = readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");

  assert.match(home, />Obrolan<\/h1>/);
  assert.match(home, /\["agents", "Agen"\]/);
  assert.match(home, /\["rooms", "Ruang"\]/);
  assert.match(home, /Cari agen/);
  assert.match(home, /Cari ruang/);
  assert.match(home, /toggleAppSettings/);
  assert.match(app, /<MobileChatHome onOpenChat=/);
});

test("main mobile UI uses simple Indonesian labels", () => {
  const home = readFileSync(new URL("../src/components/MobileChatHome.tsx", import.meta.url), "utf8");
  const composer = readFileSync(new URL("../src/components/Composer.tsx", import.meta.url), "utf8");

  assert.match(home, /Obrolan/);
  assert.match(home, /Agen/);
  assert.match(home, /Ruang/);
  assert.match(home, /Cari agen/);
  assert.match(home, /Cari ruang/);
  assert.match(composer, /"Cepat"/);
  assert.match(composer, /"Otomatis"/);
  assert.match(composer, /"Mendalam"/);
  assert.match(composer, /Pesan ke/);
});

test("legacy default English seed text is translated only by exact match", () => {
  assert.equal(
    simpleIndonesianText("I'm Diza, your Personal AI. Tell me what you need, or make more bots, each with its own job."),
    "Saya Diza, AI pribadi Anda. Beri tahu apa yang Anda butuhkan, atau buat bot lain untuk tugas yang berbeda.",
  );
  assert.equal(simpleIndonesianText("General"), "Umum");
  assert.equal(simpleIndonesianText("Custom user message"), "Custom user message");
});
