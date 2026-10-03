// Project-owned context. Kept separate from per-agent workspace memory:
// an agent can leave a project without taking this memory with it.
import { mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { DATA_DIR } from "./config.ts";
import { atomicPrivateWrite } from "./private-storage.ts";
import type { Project } from "./projects.ts";
import { MAX_PROJECT_MEMORY } from "./projects.ts";

const ROOT = join(DATA_DIR, "project-memory");
const PROMPT_BYTES = 24 * 1024;
const PROMPT_LINES = 200;

function fileFor(projectId: string): string {
  if (!/^[\w-]{1,64}$/.test(projectId)) throw new Error("invalid project id");
  return join(ROOT, `${projectId}.md`);
}

export function readProjectMemory(projectId: string): string {
  try { return readFileSync(fileFor(projectId), "utf8"); } catch { return ""; }
}

export function writeProjectMemory(projectId: string, text: string): void {
  const bytes = Buffer.byteLength(text, "utf8");
  if (bytes > MAX_PROJECT_MEMORY) throw new Error("project memory is capped at 64KB");
  mkdirSync(ROOT, { recursive: true, mode: 0o700 });
  atomicPrivateWrite(fileFor(projectId), text);
}

export function projectMemoryPrompt(project: Project): string {
  const raw = readProjectMemory(project.id);
  if (!raw.trim()) return "";
  const lines = raw.split(/\r?\n/).slice(0, PROMPT_LINES).join("\n");
  const text = Buffer.from(lines, "utf8").subarray(0, PROMPT_BYTES).toString("utf8");
  return `Shared project memory for ${project.name}. This belongs to the project, not to any agent or provider:\n${text}`;
}
