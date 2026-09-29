const BACKEND = "https://diza-bot-5eoll.faable.link";

export default {
  async fetch(request, env) {
    const backend = new URL(env.DIZA_BACKEND_ORIGIN || BACKEND);
    const incoming = new URL(request.url);
    const target = new URL(incoming.pathname + incoming.search, backend);

    const headers = new Headers(request.headers);
    headers.set("origin", backend.origin);
    headers.delete("sec-fetch-site");
    headers.delete("forwarded");
    for (const key of [...headers.keys()]) {
      if (key.toLowerCase().startsWith("x-forwarded-")) headers.delete(key);
    }

    const upstream = new Request(target, request);
    for (const [key, value] of headers) upstream.headers.set(key, value);

    return fetch(upstream);
  },
};
