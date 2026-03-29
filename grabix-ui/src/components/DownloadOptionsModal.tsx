import type { ReactNode } from "react";
import { IconDownload, IconX } from "./Icons";

interface Option {
  id: string;
  label: string;
  help?: string;
}

interface Props {
  visible: boolean;
  title: string;
  poster?: string;
  languageOptions: Option[];
  selectedLanguage: string;
  onSelectLanguage: (value: string) => void;
  qualityOptions: Option[];
  selectedQuality: string;
  onSelectQuality: (value: string) => void;
  serverOptions?: Option[];
  selectedServer?: string;
  onSelectServer?: (value: string) => void;
  loading?: boolean;
  error?: string;
  extraContent?: ReactNode;
  onClose: () => void;
  onConfirm: () => void;
  confirmLabel?: string;
}

export default function DownloadOptionsModal({
  visible,
  title,
  poster,
  languageOptions,
  selectedLanguage,
  onSelectLanguage,
  qualityOptions,
  selectedQuality,
  onSelectQuality,
  serverOptions = [],
  selectedServer = "",
  onSelectServer,
  loading = false,
  error = "",
  extraContent,
  onClose,
  onConfirm,
  confirmLabel = "Queue Download",
}: Props) {
  if (!visible) return null;

  const renderOptionGroup = (
    heading: string,
    options: Option[],
    selected: string,
    onSelect: (value: string) => void
  ) => (
    <div style={{ marginBottom: 16 }}>
      <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 8 }}>{heading}</div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        {options.map((option) => (
          <button
            key={option.id}
            className={`quality-chip${selected === option.id ? " active" : ""}`}
            onClick={() => onSelect(option.id)}
            type="button"
            title={option.help || option.label}
          >
            <span>{option.label}</span>
            {option.help ? (
              <span style={{ display: "block", fontSize: 10, color: "var(--text-muted)", marginTop: 2 }}>
                {option.help}
              </span>
            ) : null}
          </button>
        ))}
      </div>
    </div>
  );

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.75)", zIndex: 320, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }} onClick={onClose}>
      <div style={{ width: "100%", maxWidth: 560, background: "var(--bg-surface)", borderRadius: 16, border: "1px solid var(--border)", boxShadow: "var(--shadow-lg)", overflow: "hidden" }} onClick={(event) => event.stopPropagation()}>
        <div style={{ display: "flex", gap: 14, padding: "18px 18px 0" }}>
          {poster ? <img src={poster} alt={title} style={{ width: 84, height: 118, objectFit: "cover", borderRadius: 10, border: "1px solid var(--border)", flexShrink: 0 }} /> : null}
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 6 }}>{title}</div>
            <div style={{ fontSize: 12, color: "var(--text-muted)" }}>
              Choose the download language{serverOptions.length > 0 ? ", server," : ""} and quality before queueing.
            </div>
          </div>
          <button className="btn-icon" style={{ alignSelf: "flex-start", flexShrink: 0 }} onClick={onClose}>
            <IconX size={16} />
          </button>
        </div>

        <div style={{ padding: 18 }}>
          {renderOptionGroup("Language", languageOptions, selectedLanguage, onSelectLanguage)}
          {serverOptions.length > 0 && onSelectServer ? renderOptionGroup("Server", serverOptions, selectedServer, onSelectServer) : null}
          {renderOptionGroup("Quality", qualityOptions, selectedQuality, onSelectQuality)}
          {extraContent ? <div style={{ marginBottom: 16 }}>{extraContent}</div> : null}

          {error ? <div style={{ fontSize: 12, color: "var(--text-danger)", marginBottom: 12 }}>{error}</div> : null}

          <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
            <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
            <button className="btn btn-primary" onClick={onConfirm} disabled={loading || !selectedLanguage || !selectedQuality || qualityOptions.length === 0 || (serverOptions.length > 0 && !selectedServer)}>
                <IconDownload size={15} />
                {loading ? "Preparing..." : confirmLabel}
              </button>
          </div>
        </div>
      </div>
    </div>
  );
}
