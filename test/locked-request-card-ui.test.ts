import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

test("live request cards keep locked presentation while semantics stay separate", () => {
  const ui = fs.readFileSync("src/components/OptionCard.tsx", "utf8");
  assert.match(ui, /liveRequest \? "grid grid-cols-2/);
  assert.match(ui, /liveRequest[\s\S]*flex min-h-11 items-center justify-center rounded-xl/);
  assert.match(ui, /permission \? "Perlu persetujuan" : question \? "Pertanyaan"/);
  assert.match(ui, /!card\.answered && permission && card\.tool/);
});
