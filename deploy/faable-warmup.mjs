import { createServer } from "node:http";

const port = Number(process.env.PORT || 10000);
const server = createServer((req, res) => {
  const url = req.url ?? "/";
  const health = req.method === "GET" && (url === "/healthz" || url === "/api/health");
  const api = url.startsWith("/api/");
  const status = health ? 200 : api ? 503 : 200;
  const json = health || api;

  res.writeHead(status, {
    "content-type": json ? "application/json; charset=utf-8" : "text/plain; charset=utf-8",
    "cache-control": "no-store",
    ...(api && !health ? { "retry-after": "1" } : {}),
  });
  res.end(
    health
      ? JSON.stringify({ ok: true, starting: true })
      : api
        ? JSON.stringify({ error: "DIZA is starting. Please retry in a moment.", starting: true })
        : "DIZA is starting. Please retry in a moment.\n",
  );
});

server.listen(port, "0.0.0.0", () => {
  console.log(`[diza-warmup] listening on port ${port} while runtime dependencies initialize`);
});

function stop() {
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 1_000).unref?.();
}

for (const signal of ["SIGTERM", "SIGINT"]) process.on(signal, stop);
