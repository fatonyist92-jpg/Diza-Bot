import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
const store = fs.readFileSync(path.resolve("server/store.ts"), "utf8");
const attachments = fs.readFileSync(path.resolve("server/attachments.ts"), "utf8");
const bus = fs.readFileSync(path.resolve("server/harness/bus.ts"), "utf8");

test("core conversation persistence uses private atomic writes", () => {
  assert.match(store, /atomicPrivateWrite\(BOTS_FILE/);
  assert.match(store, /atomicPrivateWrite\(messagesFile\(threadId\)/);
});
test("browser uploads are private on disk", () => {
  assert.match(attachments, /Buffer\.concat\(chunks\), \{ mode: 0o600 \}/);
});
test("diagnostic disk log excludes provider raw payload", () => {
  assert.match(bus, /const \{ raw: _raw, \.\.\.safe \} = event/);
  assert.match(bus, /JSON\.stringify\(safe\)/);
});

test("backup contract keeps secret config outside ordinary data inventory", async () => {
  const { DATA_BACKUP_ENTRIES, SECRET_BACKUP_ENTRIES } = await import("../server/data-inventory.ts");
  assert.equal(DATA_BACKUP_ENTRIES.some((entry) => /config|secret|token|credential/i.test(entry)), false);
  assert.deepEqual([...SECRET_BACKUP_ENTRIES], ["config.json"]);
});
