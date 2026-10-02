import { createServer } from "node:http";

const port = Number(process.env.PORT || 10000);
const server = createServer((req, res) => {
  const health = req.method === "GET" && (req.url === "/healthz" || req.url === "/api/health");
  res.writeHead(200, {
    "content-type": health ? "application/json; charset=utf-8" : "text/plain; charset=utf-8",
    "cache-control": "no-store",
  });
  res.end(
    health
      ? JSON.stringify({ ok: true, starting: true })
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
