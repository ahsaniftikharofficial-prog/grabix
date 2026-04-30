import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";

// ── Startup WebView2 repaint pulse ──────────────────────────────────────────
// On Windows, WebView2 can drop its GPU rendering layer during CPU-intensive
// operations such as the Python/PyO3 backend startup.  The window goes blank
// even though the app is running fine.  Nudging body.opacity every few seconds
// keeps the compositor active throughout the full backend warmup window.
// The opacity change is sub-1% and lasts a single animation frame — invisible
// to the user but enough to force a GPU redraw command.
(function startupRepaintPulse() {
  let ticks = 0;
  const MAX_TICKS = 36; // 36 × 2.5 s ≈ 90 s — covers full PyO3/uvicorn warmup
  const id = setInterval(() => {
    if (document.body) {
      const s = document.body.style;
      s.opacity = "0.99";
      requestAnimationFrame(() => { s.opacity = ""; });
    }
    if (++ticks >= MAX_TICKS) clearInterval(id);
  }, 2500);
  // Also repaint immediately on any visibility change (tab switch, window restore)
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden && document.body) {
      const s = document.body.style;
      s.opacity = "0.99";
      requestAnimationFrame(() => { s.opacity = ""; });
    }
  });
})();

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
