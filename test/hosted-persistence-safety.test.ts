import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const web = fs.readFileSync("deploy/web.mjs", "utf8");
const start = fs.readFileSync("deploy/start-web.sh", "utf8");

test("hosted DIZA fails closed instead of booting an empty workspace when restore fails", () => {
  assert.match(web, /const persistenceRequired = Boolean\(process\.env\.DATABASE_URL \|\| process\.env\.NEON_DATABASE_URL\)/);
  assert.match(web, /const core = persistenceHealthy[\s\S]{0,220}\? spawn\(/);
  assert.match(web, /core held offline: persistence/);
  assert.match(web, /if \(!core && !health\)/);
  assert.match(web, /saved workspace cannot be replaced by an empty one/);
});

test("Faable runtime carries the direct Postgres restore fallback", () => {
  assert.match(start, /PG_VERSION="8\.16\.3"/);
  assert.match(start, /npm install -g --prefix "\$HOME\/\.local".*"pg@\$PG_VERSION"/);
});
