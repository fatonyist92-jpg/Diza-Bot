import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { simpleIndonesianText } from "../src/lib/uiLanguage.ts";

test("mobile chat removes the task strip area while desktop keeps it", () => {
  const chat = readFileSync(new URL("../src/components/ChatView.tsx", import.meta.url), "utf8");
  assert.match(chat, /className="hidden md:block"[\s\S]*<TaskStrip/);
});

test("mobile Account opens profile information instead of app settings", () => {
  const home = readFileSync(new URL("../src/components/MobileChatHome.tsx", import.meta.url), "utf8");
  const app = readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");
  const profile = readFileSync(new URL("../src/components/ProfilePanel.tsx", import.meta.url), "utf8");

  assert.match(home, /onOpenProfile/);
  assert.match(home, /> Akun<\/button>/);
  assert.doesNotMatch(home, /Account<\/button>/);
  assert.match(app, /<ProfilePanel onClose=/);
  assert.match(profile, /Profil Saya/);
  assert.match(profile, /Tentang saya/);
  assert.match(profile, /Cara saya ingin DIZA menjawab/);
  assert.match(profile, /api\("\/api\/config"/);
});

test("main mobile UI uses simple Indonesian labels", () => {
  const home = readFileSync(new URL("../src/components/MobileChatHome.tsx", import.meta.url), "utf8");
  const composer = readFileSync(new URL("../src/components/Composer.tsx", import.meta.url), "utf8");

  assert.match(home, /AI PRIBADI/);
  assert.match(home, /> Ruang<\/button>/);
  assert.match(home, /> Bot<\/button>/);
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
