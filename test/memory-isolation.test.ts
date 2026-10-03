import test from "node:test";
import assert from "node:assert/strict";
import { workspaceDir } from "../server/workspace.ts";
import { engineIsFresh } from "../server/turn-context.ts";

test("bot memory ownership is isolated by bot id", () => {
  assert.notEqual(workspaceDir("bot-a"), workspaceDir("bot-b"));
  assert.match(workspaceDir("bot-a"), /bot-a$/);
  assert.match(workspaceDir("bot-b"), /bot-b$/);
});

test("fallback engine is fresh when configured lane was served by another engine", () => {
  assert.equal(engineIsFresh({ instanceId: "engine-b", lastInstanceId: "engine-a", resumeCursors: { "engine-a": "cursor-a" }, hasUserTurn: true }), true);
});

test("same engine may resume only its own cursor lane", () => {
  assert.equal(engineIsFresh({ instanceId: "engine-b", lastInstanceId: "engine-b", resumeCursors: { "engine-b": "cursor-b" }, hasUserTurn: true }), false);
});
