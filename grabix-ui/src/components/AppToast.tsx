import { IconAlert, IconCheck, IconInfo, IconX } from "./Icons";

type ToastVariant = "info" | "success" | "error";

export default function AppToast({
  message,
  onClose,
  variant = "info",
}: {
  message: string;
  onClose: () => void;
  variant?: ToastVariant;
}) {
  const accent =
    variant === "success"
      ? "var(--text-success)"
      : variant === "error"
        ? "var(--text-danger)"
        : "var(--text-accent)";

  const Icon =
    variant === "success"
      ? IconCheck
      : variant === "error"
        ? IconAlert
        : IconInfo;

  return (
    <div
      style={{
        position: "fixed",
        right: 24,
        bottom: 24,
        zIndex: 2200,
        maxWidth: 360,
        display: "flex",
        alignItems: "center",
        gap: 12,
        padding: "13px 18px",
        borderRadius: 12,
        background: "var(--bg-surface)",
        border: "1px solid var(--border)",
        boxShadow: "var(--shadow-lg)",
        color: "var(--text-primary)",
        animation: "fadeSlideIn 0.2s ease",
      }}
    >
      <Icon size={16} color={accent} />
      <span style={{ flex: 1, fontSize: 13 }}>{message}</span>
      <button
        onClick={onClose}
        style={{
          background: "none",
          border: "none",
          color: "var(--text-muted)",
          cursor: "pointer",
          display: "flex",
          padding: 0,
        }}
      >
        <IconX size={14} />
      </button>
    </div>
  );
}
