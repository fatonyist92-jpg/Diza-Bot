import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const server = fs.readFileSync("server/index.ts", "utf8");
const bootstrap = fs.readFileSync("src/lib/webPairing.ts", "utf8");
const main = fs.readFileSync("src/main.tsx", "utf8");

test("public Web/PWA shell is readable before pairing but API remains outside that exception", () => {
  assert.match(server, /Boolean\(STATIC_DIR\) && !path\.startsWith\("\/api\/"\)/);
});

test("successful web pairing sets a secure HttpOnly same-site cookie", () => {
  assert.match(server, /diza_pair=\$\{claimed\.token\}/);
  assert.match(server, /HttpOnly; Secure; SameSite=Strict/);
});

test("one-time hash credential is claimed before app render and then removed from the URL", () => {
  assert.match(bootstrap, /hash\.get\("pair"\)/);
  assert.match(bootstrap, /fetch\("\/api\/pair\/claim"/);
  assert.match(bootstrap, /hash\.delete\(access \? "access" : "pair"\)/);
  assert.match(main, /await claimWebPairing\(\)/);
});

test("pre-registered live access token can only exchange an existing device token for a cookie", () => {
  assert.match(server, /path === "\/api\/web\/session"/);
  assert.match(server, /if \(!deviceForToken\(token\)\) return json\(res, 401/);
  assert.match(bootstrap, /hash\.get\("access"\)/);
  assert.match(bootstrap, /fetch\("\/api\/web\/session"/);
  assert.match(bootstrap, /hash\.delete\(access \? "access" : "pair"\)/);
});
