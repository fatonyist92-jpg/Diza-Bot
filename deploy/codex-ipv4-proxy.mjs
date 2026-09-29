import net from "node:net";
import dns from "node:dns/promises";

const port = Number(process.env.CODEX_IPV4_PROXY_PORT || 3129);

const server = net.createServer((client) => {
  client.once("data", async (head) => {
    const first = head.toString("latin1").split("\r\n", 1)[0] || "";
    const match = /^CONNECT ([^:]+):(\d+) HTTP\/1\.[01]$/.exec(first);
    if (!match) {
      client.end("HTTP/1.1 405 Method Not Allowed\r\nConnection: close\r\n\r\n");
      return;
    }
    try {
      const { address } = await dns.lookup(match[1], { family: 4 });
      const upstream = net.connect(Number(match[2]), address, () => {
        client.write("HTTP/1.1 200 Connection Established\r\n\r\n");
        upstream.pipe(client);
        client.pipe(upstream);
      });
      upstream.on("error", () => client.destroy());
      client.on("error", () => upstream.destroy());
    } catch {
      client.destroy();
    }
  });
});

server.listen(port, "127.0.0.1");
