import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

test("avatar upload and removal fold the returned bot into serverless UI state", () => {
  const source = fs.readFileSync("src/components/SettingsPanel.tsx", "utf8");
  const folds = source.match(/dispatch\(\{ type: "botPatched", bot: patched \}\)/g) ?? [];
  assert.ok(folds.length >= 2, "upload and remove must both apply returned bot state");
  assert.match(source, /setAvatarError\(error instanceof Error \? error\.message : "Foto gagal disimpan\."/);
  assert.match(source, /setAvatarError\(error instanceof Error \? error\.message : "Foto gagal dihapus\."/);
  assert.match(source, /image\.onerror/);
});

test("avatar controls are localized consistently", () => {
  const source = fs.readFileSync("src/components/SettingsPanel.tsx", "utf8");
  assert.match(source, />\s*Hapus foto\s*</);
  assert.doesNotMatch(source, />Remove photo</);
});
