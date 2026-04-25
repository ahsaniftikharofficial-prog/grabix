// components/search/LiveSearch.tsx
// Debounced live search — results appear as you type (400ms delay).
// Drop-in replacement for the existing search input + button combo.
import { useEffect, useRef, useState } from "react";
import { IconSearch } from "../Icons";

interface Props {
  value: string;
  onChange: (val: string) => void;
  /** Fired after debounce delay with the trimmed query (empty string = clear) */
  onSearch: (query: string) => void;
  placeholder?: string;
  debounceMs?: number;
  /** Keeps the Search button so accessibility / power-users can force submit */
  showButton?: boolean;
}

export function LiveSearch({
  value,
  onChange,
  onSearch,
  placeholder = "Search…",
  debounceMs = 400,
  showButton = true,
}: Props) {
  const [debouncing, setDebouncing] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Debounce: every keystroke resets the timer
  useEffect(() => {
    if (timerRef.current) clearTimeout(timerRef.current);

    if (!value.trim()) {
      setDebouncing(false);
      onSearch("");
      return;
    }

    setDebouncing(true);
    timerRef.current = setTimeout(() => {
      setDebouncing(false);
      onSearch(value.trim());
    }, debounceMs);

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, debounceMs]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      if (timerRef.current) clearTimeout(timerRef.current);
      setDebouncing(false);
      onSearch(value.trim());
    }
    if (e.key === "Escape") {
      onChange("");
      onSearch("");
    }
  };

  const handleClear = () => {
    onChange("");
    onSearch("");
  };

  return (
    <div style={{ display: "flex", gap: 6, flex: 1, minWidth: 200, maxWidth: 380 }}>
      <div style={{ position: "relative", flex: 1 }}>
        {/* Search icon or spinner */}
        <div
          style={{
            position: "absolute",
            left: 10,
            top: "50%",
            transform: "translateY(-50%)",
            pointerEvents: "none",
            display: "flex",
            alignItems: "center",
          }}
        >
          {debouncing ? (
            <div
              style={{
                width: 12,
                height: 12,
                border: "2px solid var(--text-muted)",
                borderTopColor: "var(--accent)",
                borderRadius: "50%",
                animation: "gx-spin 0.6s linear infinite",
              }}
            />
          ) : (
            <IconSearch size={13} color="var(--text-muted)" />
          )}
        </div>

        <input
          className="input-base"
          style={{ paddingLeft: 32, paddingRight: value ? 28 : 10, width: "100%", fontSize: 13 }}
          placeholder={placeholder}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={handleKeyDown}
          autoComplete="off"
          spellCheck={false}
        />

        {/* Clear × button inside the input */}
        {value && (
          <button
            onClick={handleClear}
            tabIndex={-1}
            style={{
              position: "absolute",
              right: 8,
              top: "50%",
              transform: "translateY(-50%)",
              background: "none",
              border: "none",
              cursor: "pointer",
              color: "var(--text-muted)",
              fontSize: 14,
              lineHeight: 1,
              padding: 2,
            }}
            title="Clear search"
          >
            ×
          </button>
        )}
      </div>

      {showButton && (
        <button
          className="btn btn-primary"
          style={{ fontSize: 13, whiteSpace: "nowrap" }}
          onClick={() => onSearch(value.trim())}
        >
          Search
        </button>
      )}

      <style>{`
        @keyframes gx-spin {
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
}
