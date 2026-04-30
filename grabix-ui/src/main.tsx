import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { ErrorBoundary } from "./components/ErrorBoundary";

// ── Startup WebView2 repaint pulse ──────────────────────────────────────────
// Belt-and-suspenders backup: the primary fix is --disable-gpu in tauri.conf.json
// which stops WebView2's GPU compositor from dropping.  This pulse handles
// any remaining edge-cases (minimize→restore, display sleep, etc.) by nudging
// body.opacity each time the window becomes visible.  It is cheap — one RAF
// per event — and runs for the lifetime of the app.
(function startupRepaintPulse() {
  function nudge() {
    if (document.body) {
      const s = document.body.style;
      s.opacity = "0.99";
      requestAnimationFrame(() => { s.opacity = ""; });
    }
  }
  // Fire every 1 s for the first 60 s (covers PyO3/uvicorn warmup).
  let ticks = 0;
  const id = setInterval(() => { nudge(); if (++ticks >= 60) clearInterval(id); }, 1000);
  // Also fire whenever the tab/window becomes visible again.
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) nudge();
  });
})();

const RootWrapper = import.meta.env.DEV ? React.StrictMode : React.Fragment;

ReactDOM.createRoot(document.getElementById("root")!).render(
  <RootWrapper>
    <ErrorBoundary section="GRABIX">
      <App />
    </ErrorBoundary>
  </RootWrapper>
);
