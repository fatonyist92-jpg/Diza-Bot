import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { McpClient } from "../server/mcp-client.ts";

test("app-owned browser helper exposes its tools through the generic MCP client", async () => {
  const helper = fileURLToPath(new URL("../server/browser-proxy.ts", import.meta.url));
  const client = new McpClient();
  const config = {
    id: "browser-research-test",
    name: "browser",
    transport: "stdio" as const,
    command: process.execPath,
    args: ["--experimental-strip-types", helper],
    env: {
      BLOKS_BROWSER_PROFILE: "/tmp/bloks-browser-research-test",
      BLOKS_BROWSER_PORT: "19999",
    },
  };
  try {
    const tools = await client.tools(config);
    const names = new Set(tools.map((tool) => tool.name));
    assert.equal(names.has("browser_open"), true);
    assert.equal(names.has("browser_read"), true);
    assert.equal(names.has("browser_snapshot"), true);
  } finally {
    client.close(config.id);
  }
});
