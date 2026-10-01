import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import {
  isPermissionCard,
  isQuestionCard,
  type OptionCardData,
} from "../src/state/reducer.ts";
import { simpleIndonesianText } from "../src/lib/uiLanguage.ts";

const card = (over: Partial<OptionCardData> = {}): OptionCardData => ({
  title: "t",
  subtitle: "s",
  options: ["ya", "tidak"],
  ...over,
});

test("blocking questions are not permission cards", () => {
  const question = card({ requestId: "r1", requestType: "question" });
  assert.equal(isQuestionCard(question), true);
  assert.equal(isPermissionCard(question), false);
});

test("blocking permissions are permission cards", () => {
  const permission = card({ requestId: "r2", requestType: "permission", tool: "write_file" });
  assert.equal(isPermissionCard(permission), true);
  assert.equal(isQuestionCard(permission), false);
});

test("legacy saved cards remain classifiable", () => {
  assert.equal(isQuestionCard(card({ requestId: "old-question" })), true);
  assert.equal(isPermissionCard(card({ requestId: "old-permission", tool: "Bash" })), true);
});

test("live question cards carry their type and settle to the actual answer", () => {
  const server = fs.readFileSync("server/index.ts", "utf8");
  const driver = fs.readFileSync("server/drivers/openai-compat.ts", "utf8");
  const contracts = fs.readFileSync("server/contracts.ts", "utf8");
  assert.match(server, /requestType: asking \? "question" : "permission"/);
  assert.match(server, /event\.answer \?\? event\.behavior/);
  assert.match(driver, /type: "request\.resolved"[\s\S]{0,180}source: "user",[\s\S]{0,80}answer,/);
  assert.match(contracts, /type: "request\.resolved"; behavior: string; source: string; answer\?: string/);
});

test("question cards do not enter the bulk approval controls", () => {
  const chat = fs.readFileSync("src/components/ChatView.tsx", "utf8");
  assert.match(chat, /pendingApprovals[\s\S]{0,500}isPermissionCard\(m\.card\)/);
  assert.match(chat, /waitingOnQuestion[\s\S]{0,500}isQuestionCard\(m\.card\)/);
  assert.match(chat, /Menunggu jawaban Anda/);
});

test("dismissing a question answers it as skipped rather than denying permission", () => {
  const client = fs.readFileSync("src/state/store.tsx", "utf8");
  const server = fs.readFileSync("server/index.ts", "utf8");
  assert.match(client, /permission \? "deny" : "answer"/);
  assert.match(client, /Pertanyaan dilewati oleh pengguna/);
  assert.match(client, /dismissed: true/);
  assert.match(server, /body\.dismissed === true/);
});

test("Indonesian UI translates live request titles", () => {
  assert.equal(simpleIndonesianText("Your agent has a question"), "Agen Anda punya pertanyaan");
  assert.equal(simpleIndonesianText("Approval needed"), "Perlu persetujuan");
});
