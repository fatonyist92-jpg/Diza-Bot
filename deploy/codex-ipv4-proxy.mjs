import net from "node:net";
import tls from "node:tls";
import dns from "node:dns/promises";

const port = Number(process.env.CODEX_IPV4_PROXY_PORT || 3129);
const authHost = "auth.openai.com";
const authPath = "/api/accounts/deviceauth/usercode";
const codexClientId = "app_EMoamEEZ73f0CkXaXp7hrann";

const server = net.createServer((client) => {
  client.once("data", async (head) => {
    const first = head.toString("latin1").split("\r\n", 1)[0] || "";
    const match = /^CONNECT ([^:]+):(\d+) HTTP\/1\.[01]$/.exec(first);
    if (!match) {
      console.error("[diza-codex-proxy] rejected non-CONNECT request");
      client.end("HTTP/1.1 405 Method Not Allowed\r\nConnection: close\r\n\r\n");
      return;
    }

    const host = match[1];
    const targetPort = Number(match[2]);
    try {
      const { address } = await dns.lookup(host, { family: 4 });
      console.error(`[diza-codex-proxy] CONNECT ${host}:${targetPort} -> ${address}`);
      const upstream = net.connect(targetPort, address, () => {
        client.write("HTTP/1.1 200 Connection Established\r\n\r\n");
        upstream.pipe(client);
        client.pipe(upstream);
      });
      upstream.on("error", (error) => {
        console.error(`[diza-codex-proxy] upstream error ${host}: ${error?.code || "UNKNOWN"}`);
        client.destroy();
      });
      client.on("error", () => upstream.destroy());
    } catch (error) {
      console.error(`[diza-codex-proxy] DNS error ${host}: ${error?.code || "UNKNOWN"}`);
      client.destroy();
    }
  });
});

function probeAuthThroughProxy() {
  const socket = net.connect(port, "127.0.0.1");
  socket.setTimeout(10_000);
  let connectReply = "";

  const fail = (stage, error) => {
    console.error(`[diza-codex-probe] ${stage}: ${error?.code || error?.message || String(error)}`);
    socket.destroy();
  };

  socket.once("connect", () => {
    socket.write(`CONNECT ${authHost}:443 HTTP/1.1\r\nHost: ${authHost}:443\r\nConnection: keep-alive\r\n\r\n`);
  });

  const onProxyData = (chunk) => {
    connectReply += chunk.toString("latin1");
    const end = connectReply.indexOf("\r\n\r\n");
    if (end < 0) return;
    socket.off("data", onProxyData);
    const statusLine = connectReply.slice(0, end).split("\r\n", 1)[0] || "";
    if (!/^HTTP\/1\.[01] 200\b/.test(statusLine)) {
      fail("proxy CONNECT failed", new Error(statusLine || "no status"));
      return;
    }

    const secure = tls.connect({
      socket,
      servername: authHost,
      rejectUnauthorized: true,
      ALPNProtocols: ["http/1.1"],
    });
    secure.setTimeout(10_000);

    secure.once("secureConnect", () => {
      console.error(
        `[diza-codex-probe] TLS authorized=${secure.authorized} protocol=${secure.getProtocol() || "unknown"}`,
      );
      const body = JSON.stringify({ client_id: codexClientId });
      secure.write(
        `POST ${authPath} HTTP/1.1\r\n` +
          `Host: ${authHost}\r\n` +
          "Content-Type: application/json\r\n" +
          "Accept: application/json\r\n" +
          "User-Agent: codex-cli/0.158.0\r\n" +
          `Content-Length: ${Buffer.byteLength(body)}\r\n` +
          "Connection: close\r\n\r\n" +
          body,
      );
    });

    let responseHead = "";
    secure.on("data", (chunk) => {
      if (responseHead.includes("\r\n\r\n")) return;
      responseHead += chunk.toString("latin1");
      const headEnd = responseHead.indexOf("\r\n\r\n");
      if (headEnd < 0) return;
      const lines = responseHead.slice(0, headEnd).split("\r\n");
      const status = lines.shift() || "";
      const headers = new Map();
      for (const line of lines) {
        const split = line.indexOf(":");
        if (split > 0) headers.set(line.slice(0, split).trim().toLowerCase(), line.slice(split + 1).trim());
      }
      console.error(
        `[diza-codex-probe] HTTP status="${status}" server="${headers.get("server") || ""}" cf-mitigated="${headers.get("cf-mitigated") || ""}" content-type="${headers.get("content-type") || ""}"`,
      );
      secure.destroy();
    });
    secure.once("error", (error) => {
      console.error(`[diza-codex-probe] TLS/HTTP error: ${error?.code || error?.message || String(error)}`);
    });
    secure.once("timeout", () => {
      console.error("[diza-codex-probe] TLS/HTTP timeout");
      secure.destroy();
    });
  };

  socket.on("data", onProxyData);
  socket.once("error", (error) => fail("proxy socket error", error));
  socket.once("timeout", () => fail("proxy socket timeout", new Error("timeout")));
}

server.listen(port, "127.0.0.1", () => {
  console.error(`[diza-codex-proxy] listening on 127.0.0.1:${port}`);
  console.error(`[diza-codex-env] CODEX_CA_CERTIFICATE=${process.env.CODEX_CA_CERTIFICATE ? "set" : "unset"} SSL_CERT_FILE=${process.env.SSL_CERT_FILE ? "set" : "unset"} NODE_EXTRA_CA_CERTS=${process.env.NODE_EXTRA_CA_CERTS ? "set" : "unset"}`);
  setTimeout(probeAuthThroughProxy, 100).unref?.();
});
