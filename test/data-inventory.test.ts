import test from "node:test";
import assert from "node:assert/strict";
import { DATA_BACKUP_ENTRIES, SECRET_BACKUP_ENTRIES, dataBackupManifest } from "../server/data-inventory.ts";

test("ordinary backup inventory excludes credentials", () => {
  assert.equal(DATA_BACKUP_ENTRIES.includes("config.json" as never), false);
  assert.deepEqual(SECRET_BACKUP_ENTRIES, ["config.json"]);
  const manifest = dataBackupManifest(new Date("2026-09-29T00:00:00Z"));
  assert.equal(manifest.includesSecrets, false);
  assert.equal(manifest.format, "diza-data-backup");
  assert.equal(manifest.version, 1);
});
