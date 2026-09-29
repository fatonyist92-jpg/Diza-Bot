import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const server = fs.readFileSync("server/index.ts", "utf8");

test("cloud deployment honors platform PORT without changing local override", () => {
  assert.match(server, /process\.env\.BLOKS_PORT \|\| process\.env\.PORT \|\| 8799/);
});

test("cloud deployment can explicitly bind all interfaces", () => {
  assert.match(server, /process\.env\.BLOKS_BIND_HOST \|\| bindHost\(\)/);
});
