import net from "node:net";
import dns from "node:dns/promises";

const port = Number(process.env.CODEX_IPV4_PROXY_PORT || 3129);

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

server.listen(port, "127.0.0.1", () => {
  console.error(`[diza-codex-proxy] listening on 127.0.0.1:${port}`);
});
