import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const termux = fs.readFileSync("deploy/termux-hostc.mjs", "utf8");
const launcher = fs.readFileSync("deploy/start-termux.sh", "utf8");
const pkg = JSON.parse(fs.readFileSync("package.json", "utf8"));

test("Termux launcher boots the DIZA HostC gateway recipe", () => {
  assert.match(launcher, /Node\.js 22\+/);
  assert.match(launcher, /pnpm install --frozen-lockfile/);
  assert.match(launcher, /pnpm build/);
  assert.match(launcher, /DIZA_START_HOSTC/);
  assert.match(launcher, /exec node deploy\/termux-hostc\.mjs/);
  assert.equal(pkg.scripts["start:termux"], "sh deploy/start-termux.sh");
});

test("HostC gateway keeps the DIZA core private and exposes a local health route", () => {
  assert.match(termux, /BLOKS_LOOPBACK_ONLY: "1"/);
  assert.match(termux, /BLOKS_BIND_HOST: "127\.0\.0\.1"/);
  assert.match(termux, /gateway\.listen\(gatewayPort, "127\.0\.0\.1"/);
  assert.match(termux, /path: "\/api\/health"/);
  assert.match(termux, /npx/);
  assert.match(termux, /hostc@latest/);
  assert.match(termux, /delete headers\.authorization/);
  assert.match(termux, /delete headers\.cookie/);
});
