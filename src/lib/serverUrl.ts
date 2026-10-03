export const DIZA_SERVER_URL_KEY = "diza-server-url";

export function normalizeServerUrl(value: string): string {
  const trimmed = value.trim().replace(/\/+$/, "");
  if (!trimmed) return "";
  try {
    const url = new URL(trimmed);
    if (url.protocol !== "http:" && url.protocol !== "https:") return "";
    return url.toString().replace(/\/+$/, "");
  } catch {
    return "";
  }
}

export function getServerUrl(): string {
  try {
    return normalizeServerUrl(localStorage.getItem(DIZA_SERVER_URL_KEY) ?? "");
  } catch {
    return "";
  }
}

export function saveServerUrl(value: string): string {
  const normalized = normalizeServerUrl(value);
  try {
    if (normalized) localStorage.setItem(DIZA_SERVER_URL_KEY, normalized);
    else localStorage.removeItem(DIZA_SERVER_URL_KEY);
  } catch {}
  return normalized;
}

export function serverUrl(path: string): string {
  if (!path.startsWith("/api/")) return path;
  const base = getServerUrl();
  return base ? `${base}${path}` : path;
}

let installed = false;

/**
 * Route every relative /api request to the server configured in Settings.
 * This keeps the Bloks/DIZA source intact while allowing the Android shell
 * to talk to a Termux server exposed through hostc.app.
 */
export function installServerFetchRouter() {
  if (installed || typeof window === "undefined") return;
  installed = true;
  const nativeFetch = window.fetch.bind(window);

  window.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    if (typeof input === "string" && input.startsWith("/api/")) {
      return nativeFetch(serverUrl(input), init);
    }
    if (input instanceof URL && input.pathname.startsWith("/api/") && input.origin === location.origin) {
      return nativeFetch(new URL(serverUrl(`${input.pathname}${input.search}`)), init);
    }
    return nativeFetch(input, init);
  }) as typeof window.fetch;
}

export async function testServer(value: string): Promise<{ ok: boolean; message: string }> {
  const base = normalizeServerUrl(value);
  if (!base) return { ok: false, message: "Alamat server tidak valid." };

  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch(`${base}/api/health`, {
      method: "GET",
      headers: { accept: "application/json" },
      signal: controller.signal,
    });
    if (!response.ok) {
      return { ok: false, message: `Server menjawab HTTP ${response.status}.` };
    }
    return { ok: true, message: "Server terhubung." };
  } catch (error) {
    const message = error instanceof Error && error.name === "AbortError"
      ? "Server tidak merespons dalam 8 detik."
      : "Server tidak dapat dihubungi.";
    return { ok: false, message };
  } finally {
    window.clearTimeout(timer);
  }
}
