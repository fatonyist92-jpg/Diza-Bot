import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const web = fs.readFileSync("deploy/web.mjs", "utf8");
const start = fs.readFileSync("deploy/start-web.sh", "utf8");

test("hosted DIZA restores object storage first and still fails closed if every durable backend fails", () => {
  assert.match(web, /let persistence = await initializeObjectPersistence\(\)/);
  assert.match(web, /const postgresPersistence = await initializeNeonPersistence\(\)/);
  assert.match(web, /const persistenceRequired = true/);
  assert.match(web, /const core = persistenceHealthy[\s\S]{0,220}\? spawn\(/);
  assert.match(web, /core held offline: persistence/);
  assert.match(web, /if \(!core && !health\)/);
  assert.match(web, /saved workspace cannot be replaced by an empty one/);
});

test("Faable runtime carries both S3 and direct Postgres persistence clients", () => {
  assert.match(start, /PG_VERSION="8\.16\.3"/);
  assert.match(start, /npm install -g --prefix "\$HOME\/\.local".*"pg@\$PG_VERSION"/);
  assert.match(start, /AWS_S3_VERSION="3\.901\.0"/);
  assert.match(start, /@aws-sdk\/client-s3@\$AWS_S3_VERSION/);
});
