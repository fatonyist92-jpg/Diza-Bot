export function registerPwa(): void {
  if (!("serviceWorker" in navigator)) return;
  if (location.protocol !== "https:" && location.hostname !== "localhost" && location.hostname !== "127.0.0.1") return;

  const register = () => {
    void navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => {
      // PWA support is additive. Chat must still work if registration is unavailable.
    });
  };

  // start() waits for pairing before it reaches here. On a slow tunnel the
  // load event can already have fired, so waiting for another one would
  // leave the PWA unregistered forever.
  if (document.readyState === "complete") {
    register();
    return;
  }
  window.addEventListener("load", register, { once: true });
}
