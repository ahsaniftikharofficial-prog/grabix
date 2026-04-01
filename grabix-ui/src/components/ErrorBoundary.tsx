/**
 * Phase 5 — Per-section React Error Boundary
 *
 * Wraps any section (Anime, Manga, Movies, etc.) so that if one crashes,
 * the rest of the app keeps working. Shows a minimal recovery UI.
 */
import { Component, type ErrorInfo, type ReactNode } from "react";
import { IconX, IconRefresh } from "./Icons";

interface Props {
  /** A friendly name shown in the error UI, e.g. "Anime" */
  section: string;
  children: ReactNode;
  /** Optional custom fallback — overrides the default error card */
  fallback?: (error: Error, reset: () => void) => ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // Surface in dev console — keeps the normal React overlay working
    console.error(`[ErrorBoundary:${this.props.section}]`, error, info.componentStack);
  }

  reset = () => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (!this.state.hasError) return this.props.children;

    const { section, fallback } = this.props;
    const error = this.state.error ?? new Error("Unknown error");

    if (fallback) return fallback(error, this.reset);

    return <ErrorFallback section={section} error={error} onReset={this.reset} />;
  }
}

// ── Default fallback UI ────────────────────────────────────────────────────

function ErrorFallback({
  section,
  error,
  onReset,
}: {
  section: string;
  error: Error;
  onReset: () => void;
}) {
  return (
    <div className="empty-state" style={{ gap: 12 }}>
      <div
        style={{
          width: 48,
          height: 48,
          borderRadius: "50%",
          background: "rgba(255,80,80,0.12)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <IconX size={24} style={{ color: "var(--text-error, #ff5050)" }} />
      </div>

      <p style={{ margin: 0 }}>{section} crashed</p>

      <span
        style={{
          fontSize: "0.78rem",
          opacity: 0.6,
          maxWidth: 320,
          textAlign: "center",
          wordBreak: "break-word",
        }}
      >
        {error.message || "An unexpected error occurred in this section."}
      </span>

      <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
        <button
          className="btn btn-ghost"
          onClick={onReset}
          style={{ display: "flex", alignItems: "center", gap: 6 }}
        >
          <IconRefresh size={13} />
          Reload {section}
        </button>
      </div>

      <span style={{ fontSize: "0.72rem", opacity: 0.35, marginTop: 2 }}>
        Other sections of GRABIX are still working.
      </span>
    </div>
  );
}
