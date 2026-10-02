import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const web = fs.readFileSync("deploy/web.mjs", "utf8");
const start = fs.readFileSync("deploy/start-web.sh", "utf8");
const warmup = fs.readFileSync("deploy/faable-warmup.mjs", "utf8");
const pkg = JSON.parse(fs.readFileSync("package.json", "utf8"));

test("hosted DIZA restores the authoritative database first and falls back to object storage", () => {
  assert.match(web, /let persistence = await initializeNeonPersistence\(\)/);
  assert.match(web, /const objectPersistence = await initializeObjectPersistence\(\)/);
  assert.match(web, /if \(!persistence\.enabled \|\| !persistence\.ready\)/);
  assert.match(web, /const persistenceRequired = true/);
  assert.match(web, /function startCore\(\)[\s\S]{0,260}spawn\(/);
  assert.match(web, /if \(persistenceHealthy\) \{[\s\S]{0,120}startCore\(\)/);
  assert.match(web, /core held offline: persistence/);
  assert.match(web, /if \(!core && !health\)/);
  assert.match(web, /saved workspace cannot be replaced by an empty one/);
});

test("Faable runtime uses build-installed provider and persistence dependencies", () => {
  assert.equal(pkg.dependencies["@openai/codex"], "0.158.0");
  assert.equal(pkg.dependencies["@google/gemini-cli"], "0.61.0");
  assert.equal(pkg.dependencies.pg, "8.16.3");
  assert.equal(pkg.dependencies["@aws-sdk/client-s3"], "3.901.0");
  assert.match(start, /node_modules\/\.bin\/codex/);
  assert.match(start, /node_modules\/\.bin\/gemini/);
  assert.doesNotMatch(start, /npm install[^\n]*@openai\/codex/);
  assert.doesNotMatch(start, /npm install[^\n]*@google\/gemini-cli/);
  assert.doesNotMatch(start, /npm install[^\n]*["']?pg@/);
  assert.doesNotMatch(start, /npm install[^\n]*@aws-sdk\/client-s3/);
});


test("offline recovery bridge exposes only an ephemeral RSA public key and starts core after durable recovery", () => {
  assert.match(web, /generateKeyPairSync\('rsa'/);
  assert.match(web, /url\.pathname === '\/__diza\/recovery-key'/);
  assert.match(web, /publicKey: recoveryKeys\.publicKey/);
  assert.doesNotMatch(web, /privateKey: recoveryKeys\.privateKey/);
  assert.match(web, /privateDecrypt\(/);
  assert.match(web, /oaepHash: 'sha256'/);
  assert.match(web, /recoverObjectPersistenceWithRawKey\(rawKey\)/);
  assert.match(web, /persistence = recovered/);
  assert.match(web, /startCore\(\)/);
  assert.match(web, /recoveryKeys = null/);
});


test("Faable warmup rejects API reads until the real DIZA core owns the port", () => {
  assert.match(warmup, /url\.startsWith\("\/api\/"\)/);
  assert.match(warmup, /res\.writeHead\(503/);
  assert.match(warmup, /"content-type": "application\/json; charset=utf-8"/);
  assert.match(warmup, /"retry-after": "1"/);
  assert.match(warmup, /starting: true/);
});
