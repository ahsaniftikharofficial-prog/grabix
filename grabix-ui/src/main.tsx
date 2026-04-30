import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { ErrorBoundary } from "./components/ErrorBoundary";

// ── Startup WebView2 repaint pulse ──────────────────────────────────────────
// BUG FIX: This was an IIFE that ran before React mounted and started a
// setInterval immediately. In a packaged EXE, the interval could fire during
// React's concurrent-render commit phase, modifying document.body.style while
// React holds an internal lock on the DOM — causing removeChild to see a
// detached node. Fix: extracted into a named function, called AFTER createRoot
// so React has exclusive DOM ownership before the first tick fires.
function startupRepaintPulse() {
  function nudge() {
    if (document.body) {
      const s = document.body.style;
      s.opacity = "0.99";
      requestAnimationFrame(() => {
        s.opacity = "";
      });
    }
  }
  // Fire every 1 s for the first 60 s (covers PyO3/uvicorn warmup).
  let ticks = 0;
  const id = setInterval(() => {
    nudge();
    if (++ticks >= 60) clearInterval(id);
  }, 1000);
  // Also fire whenever the tab/window becomes visible again.
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) nudge();
  });
}

const RootWrapper = import.meta.env.DEV ? React.StrictMode : React.Fragment;

// ── BUG FIX: Wipe WebView2-cached ghost nodes before React mounts ───────────
// Root cause of "Failed to execute 'removeChild' on 'Node': The node to be
// removed is not a child of this node":
//
//   1. In a packaged Tauri EXE, WebView2 can restore a stale DOM snapshot from
//      the previous session (back-forward cache / session storage). These ghost
//      nodes live inside #root and are unknown to React.
//   2. React 18's createRoot() does NOT clear existing children — it assumes the
//      container is empty. When its reconciler later tries to remove one of
//      those stale ghost nodes it finds the parent-child relationship broken,
//      throwing removeChild.
//   3. This only happens on first launch (cached DOM). After clicking Reload
//      the container is empty and React works fine — exactly matching the
//      reported symptom.
//
// Fix: empty #root with a safe while-loop before handing it to React, then
// call startupRepaintPulse() after createRoot so React has full DOM ownership.
const rootEl = document.getElementById("root")!;

// Drain any ghost children left by WebView2's session cache.
while (rootEl.firstChild) {
  rootEl.removeChild(rootEl.firstChild);
}

ReactDOM.createRoot(rootEl).render(
  <RootWrapper>
    <ErrorBoundary section="GRABIX">
      <App />
    </ErrorBoundary>
  </RootWrapper>
);

// Start the repaint pulse AFTER React has taken ownership of the DOM.
// Previously this ran before createRoot, risking a race with React's commit.
startupRepaintPulse();
