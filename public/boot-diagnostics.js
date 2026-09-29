(() => {
  const show = (value) => {
    const text = value instanceof Error ? (value.stack || value.message) : String(value || "Unknown startup error");
    let box = document.getElementById("diza-boot-error");
    if (!box) {
      box = document.createElement("pre");
      box.id = "diza-boot-error";
      box.style.cssText = "position:fixed;inset:16px;z-index:2147483647;overflow:auto;padding:16px;border:1px solid #52525b;border-radius:12px;background:#0e0e10;color:#ededf0;font:12px/1.5 monospace;white-space:pre-wrap";
      document.body.appendChild(box);
    }
    box.textContent = "DIZA boot error\n\n" + text;
  };
  addEventListener("error", (event) => show(event.error || event.message));
  addEventListener("unhandledrejection", (event) => show(event.reason));
  setTimeout(() => {
    const root = document.getElementById("root");
    if (root && !root.hasChildNodes()) show("React root remained empty after 8 seconds.");
  }, 8000);
})();
