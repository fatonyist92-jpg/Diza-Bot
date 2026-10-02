import { createServer } from "node:http";

const port = Number(process.env.PORT || 10000);
const server = createServer((req, res) => {
  const url = req.url ?? "/";
  const health = req.method === "GET" && (url === "/healthz" || url === "/api/health");
  const api = url.startsWith("/api/");

  if (health) {
    res.writeHead(200, {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    });
    res.end(JSON.stringify({ ok: true, starting: true }));
    return;
  }

  // The warmup listener is only a readiness shim. Returning HTTP 200 for
  // API routes makes the web client treat the plain-text startup message as
  // a successful JSON payload, which can replace arrays such as instances
  // with undefined and crash the global engine picker. A retryable 503 keeps
  // the existing client recovery path in control until the real core owns
  // the port.
  if (api) {
    res.writeHead(503, {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "retry-after": "1",
    });
    res.end(JSON.stringify({ error: "DIZA is starting. Please retry in a moment.", starting: true }));
    return;
  }

  res.writeHead(200, {
    "content-type": "text/plain; charset=utf-8",
    "cache-control": "no-store",
  });
  res.end("DIZA is starting. Please retry in a moment.\n");
});

server.listen(port, "0.0.0.0", () => {
  console.log(`[diza-warmup] listening on port ${port} while runtime dependencies initialize`);
});

function stop() {
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 1_000).unref?.();
}

for (const signal of ["SIGTERM", "SIGINT"]) process.on(signal, stop);
