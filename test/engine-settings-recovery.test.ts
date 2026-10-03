import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const source = fs.readFileSync("src/components/EnginesPanel.tsx", "utf8");

test("Engine settings retries transient Faable wakeup failures without changing the panel contract", () => {
  assert.match(source, /const ENGINE_LOAD_ATTEMPTS = 12/);
  assert.match(source, /const ENGINE_LOAD_RETRY_MS = 1_500/);
  assert.match(source, /for \(let attempt = 0; attempt < ENGINE_LOAD_ATTEMPTS; attempt \+= 1\)/);
  assert.match(source, /api\("\/api\/providers"\)/);
  assert.match(source, /api\("\/api\/instances"\)/);
  assert.match(source, /api\("\/api\/config"\)/);
  assert.match(source, /await wait\(ENGINE_LOAD_RETRY_MS\)/);
  assert.match(source, /Daftar engine belum berhasil dimuat\./);
  assert.match(source, /Coba lagi/);
});
