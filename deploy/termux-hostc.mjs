// DIZA Termux + HostC gateway.
//
// The DIZA core remains loopback-only. HostC tunnels this local gateway,
// and the gateway rewrites Host/Origin before proxying to the core so the
// original Bloks security boundary remains intact.
import { createServer, request } from "node:http";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const gatewayPort = Number(process.env.DIZA_GATEWAY_PORT || 8788);
const corePort = Number(process.env.BLOKS_PORT || 8799);
const staticDir = resolve(root, "dist");

if (!Number.isFinite(gatewayPort) || gatewayPort <= 0) throw new Error("DIZA_GATEWAY_PORT tidak valid.");
if (!Number.isFinite(corePort) || corePort <= 0) throw new Error("BLOKS_PORT tidak valid.");
if (gatewayPort === corePort) throw new Error("Port gateway dan core harus berbeda.");
if (!existsSync(resolve(staticDir, "index.html"))) {
  throw new Error("Build web DIZA belum ada. Jalankan pnpm build terlebih dahulu.");
}

let closing = false;
let core = null;
let hostc = null;

const coreEnv = {
  ...process.env,
  BLOKS_PORT: String(corePort),
  BLOKS_STATIC_DIR: staticDir,
  // Core stays private. Only this gateway may speak to it.
  BLOKS_LOOPBACK_ONLY: "1",
  BLOKS_BIND_HOST: "127.0.0.1",
};

function startCore() {
  core = spawn(
    process.execPath,
    ["--experimental-strip-types", "server/index.ts"],
    { cwd: root, env: coreEnv, stdio: "inherit" },
  );
  core.on("error", (error) => {
    console.error("[diza-termux] core gagal dimulai:", error.message);
    void stop(1);
  });
  core.on("exit", (code, signal) => {
    if (closing) return;
    console.error(`[diza-termux] core berhenti (${signal ?? code ?? "unknown"})`);
    void stop(code || 1);
  });
}

const HOP_HEADERS = new Set([
  "connection",
  "proxy-connection",
  "keep-alive",
  "transfer-encoding",
  "upgrade",
  "te",
  "trailer",
]);

const gateway = createServer((req, res) => {
  const path = req.url || "/";
  const health = req.method === "GET" && path === "/healthz";

  if (health) {
    const upstream = request(
      {
        hostname: "127.0.0.1",
        port: corePort,
        path: "/api/health",
        method: "GET",
        headers: { host: `127.0.0.1:${corePort}` },
      },
      (incoming) => {
        incoming.resume();
        const ok = incoming.statusCode === 200;
        res.writeHead(ok ? 200 : 503, {
          "content-type": "application/json",
          "cache-control": "no-store",
        });
        res.end(JSON.stringify({ ok, gateway: "termux-hostc", core: ok ? "ready" : "not-ready" }));
      },
    );
    upstream.on("error", () => {
      if (res.headersSent) return res.destroy();
      res.writeHead(503, { "content-type": "application/json", "cache-control": "no-store" });
      res.end(JSON.stringify({ ok: false, gateway: "termux-hostc", core: "starting" }));
    });
    upstream.end();
    return;
  }

  const headers = { ...req.headers };
  for (const key of Object.keys(headers)) {
    if (HOP_HEADERS.has(key.toLowerCase()) || key.toLowerCase().startsWith("x-forwarded-")) {
      delete headers[key];
    }
  }
  delete headers.forwarded;
  // Do not let a public HostC request masquerade as a paired-device token.
  delete headers.authorization;
  delete headers.cookie;

  headers.host = `127.0.0.1:${corePort}`;
  if (headers.origin) headers.origin = `http://127.0.0.1:${corePort}`;
  if (req.method === "GET" || req.method === "HEAD") delete headers["content-length"];

  const upstream = request(
    {
      hostname: "127.0.0.1",
      port: corePort,
      path,
      method: req.method,
      headers,
    },
    (incoming) => {
      const responseHeaders = { ...incoming.headers };
      for (const key of Object.keys(responseHeaders)) {
        if (HOP_HEADERS.has(key.toLowerCase())) delete responseHeaders[key];
      }
      if (path.startsWith("/api/") || path === "/sw.js") {
        responseHeaders["cache-control"] = "no-store";
      }
      res.writeHead(incoming.statusCode || 502, responseHeaders);
      incoming.pipe(res);
      incoming.on("error", () => res.destroy());
    },
  );

  upstream.on("error", () => {
    if (res.headersSent) return res.destroy();
    res.writeHead(503, {
      "content-type": "application/json",
      "cache-control": "no-store",
    });
    res.end(JSON.stringify({ error: "DIZA core sedang mulai atau belum tersedia." }));
  });

  req.on("aborted", () => upstream.destroy());
  res.on("close", () => {
    if (!res.writableEnded && !path.startsWith("/api/events")) upstream.destroy();
  });

  if (req.method === "GET" || req.method === "HEAD") upstream.end();
  else req.pipe(upstream);
});

function startHostc() {
  if (process.env.DIZA_START_HOSTC !== "1") return;
  hostc = spawn(
    "npx",
    ["--yes", "hostc@latest", String(gatewayPort)],
    { cwd: root, env: process.env, stdio: "inherit" },
  );
  hostc.on("error", (error) => {
    console.error("[diza-termux] HostC gagal dimulai:", error.message);
  });
  hostc.on("exit", (code, signal) => {
    if (closing) return;
    console.error(`[diza-termux] HostC berhenti (${signal ?? code ?? "unknown"})`);
  });
}

async function stop(code = 0) {
  if (closing) return;
  closing = true;
  gateway.close();
  hostc?.kill("SIGTERM");
  core?.kill("SIGTERM");
  const timer = setTimeout(() => process.exit(code), 2500);
  timer.unref?.();
}

startCore();
gateway.listen(gatewayPort, "127.0.0.1", () => {
  console.log(`[diza-termux] gateway lokal: http://127.0.0.1:${gatewayPort}`);
  console.log(`[diza-termux] health: http://127.0.0.1:${gatewayPort}/healthz`);
  if (process.env.DIZA_START_HOSTC === "1") {
    console.log("[diza-termux] membuka tunnel HostC…");
  } else {
    console.log(`[diza-termux] tunnel manual: npx hostc@latest ${gatewayPort}`);
  }
  startHostc();
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => void stop(0));
}
