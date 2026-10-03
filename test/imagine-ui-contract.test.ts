import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const chat = fs.readFileSync(path.resolve("src/components/ChatView.tsx"), "utf8");
const artifacts = fs.readFileSync(path.resolve("src/components/Artifacts.tsx"), "utf8");
const artifactServer = fs.readFileSync(path.resolve("server/artifacts.ts"), "utf8");
const cli = fs.readFileSync(path.resolve("bin/bloks.mjs"), "utf8");
const agent = fs.readFileSync(path.resolve("server/agent-cli.ts"), "utf8");
const server = fs.readFileSync(path.resolve("server/index.ts"), "utf8");

test("Imagine UI is dormant while historical records remain harmless", () => {
  assert.doesNotMatch(chat, /import \{ ImagineCard \}/);
  assert.match(chat, /case "imagine":[\s\S]{0,260}return null/);
  assert.match(server, /const DIZA_IMAGINE_ACTIVE = false/);
});

test("normal bot image and video attachments render directly in web chat", () => {
  assert.match(chat, /function BotText/);
  assert.match(chat, /splitAttachments\(text\)/);
  assert.match(chat, /\/api\/attachments\/\$\{attachmentBasename\(attachment\.path\)\}/);
  assert.match(chat, /<img/);
  assert.match(chat, /<video/);
  assert.match(chat, /playsInline/);
});

test("image and video deliverables open in-app", () => {
  assert.match(artifactServer, /mp4: "video\/mp4"/);
  assert.match(artifactServer, /webm: "video\/webm"/);
  assert.match(artifacts, /viewer: "video"/);
  assert.match(artifacts, /mime\.startsWith\("video\/"\)/);
  assert.match(artifacts, /<video/);
  assert.match(artifacts, /controls/);
});

test("agents no longer receive an active Imagine command or permission", () => {
  assert.doesNotMatch(cli, /\bimagine:\s*\{/);
  assert.doesNotMatch(agent, /path: "\/api\/imagine\/jobs"/);
});

test("dormant Imagine source stays available for a future explicit restore", () => {
  assert.match(server, /function createImagineJob/);
  assert.match(server, /function imagineBridgeUrl/);
  assert.match(server, /async function runImagineJob/);
  assert.match(server, /if \(DIZA_IMAGINE_ACTIVE\)[\s\S]*for \(const job of imagine\.jobs\)/);
});
