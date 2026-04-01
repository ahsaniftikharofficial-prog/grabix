import { type ReactNode } from "react";
import { IconRefresh, IconSearch, IconX } from "./Icons";
import { useRetryWithBackoff } from "../lib/useRetryWithBackoff";

export function PageLoadingState({
  title = "Loading...",
  subtitle = "Preparing this section now.",
}: {
  title?: string;
  subtitle?: string;
}) {
  return (
    <div className="empty-state">
      <div className="player-loader" />
      <p>{title}</p>
      <span>{subtitle}</span>
    </div>
  );
}

export function PageEmptyState({
  title,
  subtitle,
  icon,
  action,
}: {
  title: string;
  subtitle?: string;
  icon?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="empty-state">
      {icon ?? <IconSearch size={36} />}
      <p>{title}</p>
      {subtitle ? <span>{subtitle}</span> : null}
      {action ? <div style={{ marginTop: 4 }}>{action}</div> : null}
    </div>
  );
}

/**
 * Phase 5 — PageErrorState with optional exponential backoff.
 * Pass `useBackoff={true}` to show a countdown on the retry button (2s → 4s → 8s).
 * Without `useBackoff` it behaves exactly as before.
 */
export function PageErrorState({
  title = "Something went wrong",
  subtitle,
  actionLabel = "Try Again",
  onRetry,
  useBackoff = false,
}: {
  title?: string;
  subtitle?: string;
  actionLabel?: string;
  onRetry?: () => void;
  useBackoff?: boolean;
}) {
  const { retryState, triggerRetry } = useRetryWithBackoff({
    onRetry: onRetry ?? (() => {}),
    maxAttempts: 3,
    baseDelayMs: 2000,
  });

  const handleClick = () => {
    if (retryState.isPending) return;
    triggerRetry();
  };

  const buttonLabel =
    useBackoff && retryState.isPending
      ? `Retrying in ${retryState.countdown ?? 0}s…`
      : actionLabel;

  return (
    <PageEmptyState
      title={title}
      subtitle={subtitle}
      icon={<IconX size={34} />}
      action={
        onRetry ? (
          <button
            className="btn btn-ghost"
            onClick={handleClick}
            disabled={useBackoff && retryState.isPending}
            style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 120, justifyContent: "center" }}
          >
            <IconRefresh size={14} /> {buttonLabel}
          </button>
        ) : null
      }
    />
  );
}
