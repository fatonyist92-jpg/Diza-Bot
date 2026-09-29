export async function claimWebPairing(): Promise<void> {
  if (typeof window === "undefined") return;
  const hash = new URLSearchParams(window.location.hash.replace(/^#/, ""));
  const credential = hash.get("pair");
  if (!credential) return;

  const response = await fetch("/api/pair/claim", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ credential, device: "DIZA Web/PWA" }),
  });
  if (!response.ok) return;

  hash.delete("pair");
  const nextHash = hash.toString();
  window.history.replaceState(
    null,
    "",
    `${window.location.pathname}${window.location.search}${nextHash ? `#${nextHash}` : ""}`,
  );
}
