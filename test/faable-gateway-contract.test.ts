import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

test("Faable gateway does not carry edge transport framing into the loopback core", () => {
  const source = fs.readFileSync("deploy/web.mjs", "utf8");
  assert.match(source, /'transfer-encoding'/);
  assert.match(source, /'connection'/);
  assert.match(source, /delete headers\['content-length'\]/);
  assert.match(source, /req\.method === 'GET' \|\| req\.method === 'HEAD'\) upstream\.end\(\)/);
  assert.match(source, /upstream\.setTimeout\(10_000/);
  assert.match(source, /delete responseHeaders\[key\]/);
});
