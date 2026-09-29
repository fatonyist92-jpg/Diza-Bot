import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

test("project memory persists separately and obeys its prompt budget", () => {
  const home = mkdtempSync(join(tmpdir(), "diza-project-memory-"));
  const script = `
    import { writeProjectMemory, readProjectMemory, projectMemoryPrompt } from ${JSON.stringify(new URL("../server/project-context.ts", import.meta.url).href)};
    const p = { id:"p1", name:"Alpha", brief:"", color:"blue", shape:"star", folders:[], include:[], memberIds:[], createdAt:1 };
    writeProjectMemory("p1", Array.from({length:260}, (_,i)=>"line-"+i).join("\\n"));
    const raw = readProjectMemory("p1");
    const prompt = projectMemoryPrompt(p);
    console.log(JSON.stringify({ rawLines: raw.split(/\\n/).length, promptLines: prompt.split(/\\n/).length, prompt }));
  `;
  const run = spawnSync(process.execPath, ["--experimental-strip-types", "--input-type=module", "-e", script], {
    env: { ...process.env, HOME: home, USERPROFILE: home },
    encoding: "utf8",
  });
  try {
    assert.equal(run.status, 0, run.stderr);
    const result = JSON.parse(run.stdout.trim());
    assert.equal(result.rawLines, 260);
    assert.ok(result.promptLines <= 201);
    assert.match(result.prompt, /belongs to the project, not to any agent or provider/);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});
