/**
 * KidsProfile.tsx — Phase 6
 * Modal for setting up / exiting a kids profile.
 * Shown when you try to exit a kids-mode profile.
 */

import { useState } from "react";
import { useProfile } from "../../context/ProfileContext";

interface Props {
  onClose: () => void;
}

export function KidsPinModal({ onClose }: Props) {
  const { activeProfile, verifyKidsPin, switchProfile, profiles, setKidsPin } = useProfile();
  const [pin, setPin] = useState("");
  const [error, setError] = useState("");
  const [mode, setMode] = useState<"exit" | "setpin">("exit");
  const [newPin, setNewPin] = useState("");
  const [confirmPin, setConfirmPin] = useState("");

  const handleExit = () => {
    if (verifyKidsPin(activeProfile.id, pin)) {
      // Switch back to first non-kids profile
      const parent = profiles.find(p => !p.isKids && p.id !== activeProfile.id);
      if (parent) switchProfile(parent.id);
      else switchProfile("default");
      onClose();
    } else {
      setError("Incorrect PIN. Try again.");
      setPin("");
    }
  };

  const handleSetPin = () => {
    if (newPin.length !== 4 || !/^\d{4}$/.test(newPin)) {
      setError("PIN must be exactly 4 digits.");
      return;
    }
    if (newPin !== confirmPin) {
      setError("PINs don't match.");
      return;
    }
    setKidsPin(activeProfile.id, newPin);
    onClose();
  };

  return (
    <div
      style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.85)", zIndex: 9999, display: "flex", alignItems: "center", justifyContent: "center" }}
      onClick={onClose}
    >
      <div
        style={{ background: "var(--bg-surface)", border: "1px solid var(--border)", borderRadius: 16, padding: "28px 32px", width: "100%", maxWidth: 340, boxShadow: "var(--shadow-lg)" }}
        onClick={e => e.stopPropagation()}
      >
        <div style={{ textAlign: "center", marginBottom: 20 }}>
          <div style={{ fontSize: 40, marginBottom: 8 }}>👶</div>
          <div style={{ fontSize: 17, fontWeight: 800, color: "var(--text-primary)" }}>
            {mode === "exit" ? "Exit Kids Mode" : "Set Kids PIN"}
          </div>
          <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 4 }}>
            {mode === "exit"
              ? `Enter PIN for ${activeProfile.name} to switch profiles`
              : "Set a 4-digit PIN to protect this profile"}
          </div>
        </div>

        {mode === "exit" ? (
          <>
            <PinInput value={pin} onChange={setPin} onSubmit={handleExit} />
            {error && <div style={{ color: "var(--text-danger)", fontSize: 12, textAlign: "center", marginTop: 8 }}>{error}</div>}
            <button
              onClick={handleExit}
              disabled={pin.length < 4}
              style={{ width: "100%", marginTop: 16, background: "var(--accent)", border: "none", borderRadius: 8, padding: "10px", color: "var(--text-on-accent)", fontWeight: 700, fontSize: 14, cursor: pin.length < 4 ? "not-allowed" : "pointer", opacity: pin.length < 4 ? 0.5 : 1, fontFamily: "var(--font)" }}
            >
              Unlock
            </button>
            <button
              onClick={() => setMode("setpin")}
              style={{ width: "100%", marginTop: 8, background: "none", border: "1px solid var(--border)", borderRadius: 8, padding: "8px", color: "var(--text-secondary)", fontSize: 12, cursor: "pointer", fontFamily: "var(--font)" }}
            >
              {activeProfile.kidsPin ? "Change PIN" : "Set PIN"}
            </button>
          </>
        ) : (
          <>
            <div style={{ marginBottom: 10 }}>
              <label style={{ fontSize: 11, color: "var(--text-muted)", display: "block", marginBottom: 4 }}>New PIN</label>
              <PinInput value={newPin} onChange={setNewPin} onSubmit={() => {}} />
            </div>
            <div style={{ marginBottom: 10 }}>
              <label style={{ fontSize: 11, color: "var(--text-muted)", display: "block", marginBottom: 4 }}>Confirm PIN</label>
              <PinInput value={confirmPin} onChange={setConfirmPin} onSubmit={handleSetPin} />
            </div>
            {error && <div style={{ color: "var(--text-danger)", fontSize: 12, textAlign: "center" }}>{error}</div>}
            <button
              onClick={handleSetPin}
              style={{ width: "100%", marginTop: 12, background: "var(--accent)", border: "none", borderRadius: 8, padding: "10px", color: "var(--text-on-accent)", fontWeight: 700, fontSize: 14, cursor: "pointer", fontFamily: "var(--font)" }}
            >
              Save PIN
            </button>
            <button
              onClick={() => { setMode("exit"); setError(""); setNewPin(""); setConfirmPin(""); }}
              style={{ width: "100%", marginTop: 8, background: "none", border: "none", color: "var(--text-muted)", fontSize: 12, cursor: "pointer", fontFamily: "var(--font)" }}
            >
              ← Back
            </button>
          </>
        )}
      </div>
    </div>
  );
}

function PinInput({ value, onChange, onSubmit }: { value: string; onChange: (v: string) => void; onSubmit: () => void }) {
  return (
    <div style={{ display: "flex", gap: 10, justifyContent: "center" }}>
      {[0, 1, 2, 3].map(i => (
        <div
          key={i}
          style={{
            width: 40, height: 48, borderRadius: 8, border: "2px solid",
            borderColor: value.length > i ? "var(--accent)" : "var(--border)",
            background: "var(--bg-input)",
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: 20, fontWeight: 700, color: "var(--text-primary)",
          }}
        >
          {value[i] ? "●" : ""}
        </div>
      ))}
      <input
        type="tel" inputMode="numeric" pattern="[0-9]*" maxLength={4}
        value={value}
        onChange={e => onChange(e.target.value.replace(/\D/g, "").slice(0, 4))}
        onKeyDown={e => e.key === "Enter" && value.length === 4 && onSubmit()}
        style={{ position: "absolute", opacity: 0, width: 1, height: 1 }}
        autoFocus
      />
    </div>
  );
}
