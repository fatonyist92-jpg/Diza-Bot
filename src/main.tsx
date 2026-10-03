import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { ThemeProvider } from "./lib/theme";
import "@fontsource-variable/inter";
import "./styles.css";
import { registerPwa } from "./lib/pwa";
import { claimWebPairing } from "./lib/webPairing";

async function start() {
  await claimWebPairing().catch(() => {});
  registerPwa();

  createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ThemeProvider>
      <App />
    </ThemeProvider>
  </StrictMode>,
  );
}

void start();
