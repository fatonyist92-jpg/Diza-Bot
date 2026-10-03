import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const html = fs.readFileSync("index.html", "utf8");
const icon = fs.readFileSync("public/app-icon.svg", "utf8");
const brand = fs.readFileSync("src/components/Brand.tsx", "utf8");

test("web-facing primary identity is DIZA BOT", () => {
  assert.match(html, /<title>DIZA BOT<\/title>/);
  assert.match(icon, /<title id="title">DIZA BOT<\/title>/);
  assert.match(brand, /aria-label="DIZA BOT"/);
});

test("legacy component API can remain while visible wordmark is DIZA", () => {
  assert.match(brand, /export function BloksLogo/);
  assert.match(brand, />\s*DIZA BOT\s*</);
});
