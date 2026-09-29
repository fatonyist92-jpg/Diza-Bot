import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const source = fs.readFileSync(path.resolve("server/index.ts"), "utf8");

test("lane controls resolve the actual dispatched engine", () => {
  assert.match(source, /function instanceForTask\(bot: BotRecord, taskId\?: string \| null\)/);
  assert.match(source, /task\?\.lastInstanceId \?\? bot\.modelSelection\.instanceId/);
  assert.match(source, /instanceForTask\(bot, event\.threadId\)/);
  assert.match(source, /instanceForTask\(bot, lane\.id\)\?\.adapter\.interruptTurn/);
  assert.match(source, /instanceForTask\(bot, laneId\)/);
});

test("configured engine remains only the fallback when a lane has no owner", () => {
  const helper = source.match(/function instanceForTask[\s\S]*?\n\}/)?.[0] ?? "";
  assert.match(helper, /lastInstanceId/);
  assert.match(helper, /modelSelection\.instanceId/);
});
