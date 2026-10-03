import test from "node:test";
import assert from "node:assert/strict";
import { decideTurn, detectIntent, intentHint, parseMode } from "../server/intelligence.ts";

test("mode parser is fail-safe to auto", () => {
  assert.equal(parseMode("fast"), "fast");
  assert.equal(parseMode("expert"), "expert");
  assert.equal(parseMode("anything"), "auto");
});

test("auto keeps ordinary chat fast", () => {
  const d = decideTurn("auto", "hello there");
  assert.equal(d.intent, "chat");
  assert.equal(d.effectiveMode, "fast");
  assert.equal(d.effort, "low");
});

test("auto raises complex work to expert", () => {
  const d = decideTurn("auto", "Please analyze and debug this control logic");
  assert.equal(d.intent, "reasoning");
  assert.equal(d.effectiveMode, "expert");
  assert.equal(d.effort, "high");
});

test("attachments route by the actual Composer tags without changing mode contract", () => {
  assert.equal(detectIntent('check this <attached-image path="/tmp/a.png" />'), "image");
  assert.equal(detectIntent('watch <attached-video path="/tmp/a.mp4" />'), "video");
  assert.equal(detectIntent('read <attached-file path="/tmp/a.pdf" />'), "file");
});

test("explicit modes override auto complexity choice", () => {
  assert.equal(decideTurn("fast", "analyze this deeply").effectiveMode, "fast");
  assert.equal(decideTurn("expert", "hi").effectiveMode, "expert");
});

test("search intent remains a capability signal while auto stays lightweight", () => {
  const d = decideTurn("auto", "search the latest release notes on the web");
  assert.equal(d.intent, "search");
  assert.equal(d.effectiveMode, "fast");
});


test("capability hints never grant tools, they only describe the request", () => {
  assert.match(intentHint("search"), /Use an available web\/browser capability/);
  assert.match(intentHint("image"), /when the current engine supports it/);
});


test("auto promotes explicit deep research while keeping quick search fast", () => {
  assert.equal(decideTurn("auto", "search the latest release notes on the web").effectiveMode, "fast");
  const deep = decideTurn("auto", "research and cross-check the latest release with multiple sources");
  assert.equal(deep.intent, "search");
  assert.equal(deep.deepResearch, true);
  assert.equal(deep.effectiveMode, "expert");
  assert.equal(deep.effort, "high");
});


test("Indonesian current-info and research wording routes like English", () => {
  assert.equal(detectIntent("cari berita terbaru hari ini"), "search");
  assert.equal(detectIntent("cek harga saat ini di internet"), "search");
  const deep = decideTurn("auto", "riset berita terbaru dan cek silang beberapa sumber");
  assert.equal(deep.intent, "search");
  assert.equal(deep.deepResearch, true);
  assert.equal(deep.effectiveMode, "expert");
});
