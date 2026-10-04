import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { ThemeProvider } from "./lib/theme";
import "@fontsource-variable/inter";
import "./styles.css";
import { registerPwa } from "./lib/pwa";
import { claimWebPairing } from "./lib/webPairing";
import { installServerFetchRouter } from "./lib/serverUrl";

async function start() {
  // Must run before any app/bootstrap request so APK/PWA traffic can be
  // redirected to the server URL saved in Pengaturan (for example hostc.app).
  installServerFetchRouter();
  await claimWebPairing().catch(() => {});
  registerPwa();

  createRoot(document.getElementById("root")!).render(
    <StrictMode>
      <ThemeProvider>
        <App />
      </ThemeProvider>
    </StrictMode>,
  );

  try {
    (window as Window & {
      DizaNative?: { reportReady?: () => void };
    }).DizaNative?.reportReady?.();
  } catch {}

void start();
