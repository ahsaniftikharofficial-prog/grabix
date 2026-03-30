import type { ReactNode } from "react";
import { IconRefresh, IconSearch, IconX } from "./Icons";

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

export function PageErrorState({
  title = "Something went wrong",
  subtitle,
  actionLabel = "Try Again",
  onRetry,
}: {
  title?: string;
  subtitle?: string;
  actionLabel?: string;
  onRetry?: () => void;
}) {
  return (
    <PageEmptyState
      title={title}
      subtitle={subtitle}
      icon={<IconX size={34} />}
      action={
        onRetry ? (
          <button className="btn btn-ghost" onClick={onRetry}>
            <IconRefresh size={14} /> {actionLabel}
          </button>
        ) : null
      }
    />
  );
}
