const FALLBACK_BACKEND = "https://diza-bot-5eoll.faable.link";

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/healthz" || url.pathname.startsWith("/api/")) {
      const backend = new URL(env.DIZA_BACKEND_ORIGIN || FALLBACK_BACKEND);
      const target = new URL(url.pathname + url.search, backend);

      const upstream = new Request(target, request);
      if (upstream.headers.has("origin")) {
        upstream.headers.set("origin", backend.origin);
      }

      return fetch(upstream);
    }

    return env.ASSETS.fetch(request);
  },
};
