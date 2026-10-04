import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const server = fs.readFileSync("server/index.ts", "utf8");
const config = fs.readFileSync("server/config.ts", "utf8");
const store = fs.readFileSync("server/store.ts", "utf8");
const chat = fs.readFileSync("src/components/ChatView.tsx", "utf8");
const agentSettings = fs.readFileSync("src/components/SettingsPanel.tsx", "utf8");
const engines = fs.readFileSync("src/components/EnginesPanel.tsx", "utf8");
const picker = fs.readFileSync("src/components/ModelPicker.tsx", "utf8");

test("engine selection is workspace-wide and persisted in config", () => {
  assert.match(config, /engine\?: ModelSelection/);
  assert.match(config, /"engine",/);
  assert.match(server, /engine: \{ \.\.\.\(cfg\.engine \?\? bootSelection\) \}/);
  assert.match(server, /store\.setGlobalModelSelection\(requestedEngine\)/);
  assert.match(store, /setGlobalModelSelection\(selection: ModelSelection\)/);
});

test("boot synchronises every existing and future agent to the workspace engine", () => {
  assert.match(server, /bootSelection = await defaultSelection\(\)/);
  assert.match(server, /store\.setGlobalModelSelection\(bootSelection\)/);
  assert.match(server, /store\.seedIfEmpty\(\)/);
  assert.ok(
    server.indexOf("store.setGlobalModelSelection(bootSelection)") <
      server.indexOf("store.seedIfEmpty()"),
  );
});

test("agent surfaces no longer expose an engine picker", () => {
  assert.doesNotMatch(chat, /ModelPicker|GlobalEnginePicker/);
  assert.doesNotMatch(agentSettings, /ModelPicker|GlobalEnginePicker/);
  assert.match(engines, /GlobalEnginePicker/);
  assert.match(engines, /Hanya satu engine yang aktif untuk semua Agen dan Ruang/);
});

test("the Settings picker writes only the workspace config", () => {
  assert.match(picker, /export function GlobalEnginePicker/);
  assert.match(picker, /api\("\/api\/config"/);
  assert.match(picker, /JSON\.stringify\(\{ engine: \{ instanceId: instance\.instanceId, model \} \}\)/);
  assert.doesNotMatch(picker, /type: "setModel"/);
  assert.doesNotMatch(picker, /botId/);
});

test("legacy per-agent model changes are promoted to the whole workspace", () => {
  assert.match(server, /Backward compatibility for older clients/);
  assert.match(server, /saveConfig\(\{ engine: selection \}\)/);
  assert.match(server, /store\.setGlobalModelSelection\(selection\)/);
});


test("global engine routes reject unavailable engines and unknown models", () => {
  assert.match(server, /const snapshot = await instance\.snapshot\(\)/);
  assert.match(server, /snapshot\.state !== "available" \|\| snapshot\.authenticated === false/);
  assert.match(server, /model itu tidak tersedia pada engine yang dipilih/);
  const snapshots = server.match(/const snapshot = await instance\.snapshot\(\)/g) ?? [];
  assert.ok(snapshots.length >= 2, "both Settings and legacy global-engine routes must validate readiness");
});


test("DIZA uses exactly one active inference engine and never silently falls back", () => {
  assert.match(server, /const DIZA_SINGLE_ENGINE = true/);
  assert.match(server, /if \(!DIZA_SINGLE_ENGINE && !selectedInstance\)/);
  assert.match(server, /!DIZA_SINGLE_ENGINE &&\s*opts\.intelligenceMode/);
  assert.match(engines, /Mengaktifkan engine lain otomatis menonaktifkan engine sebelumnya/);
});
