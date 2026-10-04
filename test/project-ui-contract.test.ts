import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const panel = fs.readFileSync(path.resolve("src/components/ProjectsPanel.tsx"), "utf8");
const sidebar = fs.readFileSync(path.resolve("src/components/Sidebar.tsx"), "utf8");

test("project UI exposes brief, shared memory, archive and mobile-scrollable panel", () => {
  assert.match(panel, /Brief tetap proyek/);
  assert.match(panel, /Memori bersama proyek/);
  assert.match(panel, /\?archive=1/);
  assert.match(panel, /overflow-y-auto/);
});

test("project lens filters chats by explicit project scope and creates scoped chats", () => {
  assert.match(sidebar, /task\.projectId === state\.projectId/);
  assert.match(sidebar, /projectId: state\.projectId/);
});
