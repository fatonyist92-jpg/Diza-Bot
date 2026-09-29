export async function claimWebPairing(): Promise<void> {
  if (typeof window === "undefined") return;
  const hash = new URLSearchParams(window.location.hash.replace(/^#/, ""));
  const access = hash.get("access");
  const credential = hash.get("pair");
  if (!access && !credential) return;

  const response = access
    ? await fetch("/api/web/session", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token: access }),
      })
    : await fetch("/api/pair/claim", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ credential, device: "DIZA Web/PWA" }),
      });
  if (!response.ok) return;

  hash.delete(access ? "access" : "pair");
  const nextHash = hash.toString();
  window.history.replaceState(
    null,
    "",
    `${window.location.pathname}${window.location.search}${nextHash ? `#${nextHash}` : ""}`,
  );
}
