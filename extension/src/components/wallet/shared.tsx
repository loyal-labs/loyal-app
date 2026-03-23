import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowLeft, Search, X } from "lucide-react";

// ---------------------------------------------------------------------------
// PIN Input — 4-digit code with filled dots, auto-advance, shake on error
// ---------------------------------------------------------------------------

const PIN_LENGTH = 4;
const DOT_SIZE = 56;
const DOT_GAP = 12;

export function PinInput({
  value,
  onChange,
  onComplete,
  error,
  disabled,
  label,
}: {
  value: string;
  onChange: (pin: string) => void;
  onComplete?: (pin: string) => void;
  error?: boolean;
  disabled?: boolean;
  label?: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [shake, setShake] = useState(false);
  const [focused, setFocused] = useState(false);

  // Trigger shake animation on error
  useEffect(() => {
    if (error) {
      setShake(true);
      const t = setTimeout(() => setShake(false), 500);
      return () => clearTimeout(t);
    }
  }, [error]);

  const handleInput = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      if (disabled) return;
      const raw = e.target.value.replace(/\D/g, "").slice(0, PIN_LENGTH);
      onChange(raw);
      if (raw.length === PIN_LENGTH) {
        onComplete?.(raw);
      }
    },
    [disabled, onChange, onComplete],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (disabled) return;
      if (e.key === "Backspace" && value.length === 0) {
        e.preventDefault();
      }
    },
    [disabled, value],
  );

  const focusInput = useCallback(() => {
    inputRef.current?.focus();
  }, []);

  // Hint text for the first empty box
  const hintText = !focused && value.length === 0 ? "Click" : focused && value.length === 0 ? "Type" : null;

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: "16px",
      }}
    >
      {label && (
        <span
          style={{
            fontFamily: "var(--font-geist-sans), sans-serif",
            fontSize: "15px",
            fontWeight: 500,
            lineHeight: "20px",
            color: "rgba(60, 60, 67, 0.6)",
          }}
        >
          {label}
        </span>
      )}

      {/* Dot row — tap to focus hidden input */}
      <div
        onClick={focusInput}
        style={{
          display: "flex",
          gap: `${DOT_GAP}px`,
          cursor: value.length === 0 && !focused ? "pointer" : "default",
          animation: shake ? "pin-shake 0.5s ease" : undefined,
        }}
      >
        {Array.from({ length: PIN_LENGTH }).map((_, i) => {
          const isFilled = i < value.length;
          const isActive = i === value.length && focused && !disabled;
          const showHint = i === 0 && hintText;
          return (
            <div
              key={i}
              style={{
                width: `${DOT_SIZE}px`,
                height: `${DOT_SIZE}px`,
                borderRadius: "16px",
                background: isFilled
                  ? "#000"
                  : isActive
                    ? "rgba(249, 54, 60, 0.06)"
                    : "#fff",
                border: isActive
                  ? "2px solid #000"
                  : isFilled
                    ? "2px solid #000"
                    : "2px solid rgba(0, 0, 0, 0.06)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                transition: "all 0.15s cubic-bezier(0.4, 0, 0.2, 1)",
                boxSizing: "border-box",
              }}
            >
              {showHint ? (
                <span
                  style={{
                    fontFamily: "var(--font-geist-sans), sans-serif",
                    fontSize: "13px",
                    fontWeight: 500,
                    color: "rgba(60, 60, 67, 0.35)",
                    userSelect: "none",
                    transition: "opacity 0.15s ease",
                  }}
                >
                  {hintText}
                </span>
              ) : (
                <div
                  style={{
                    width: isFilled ? "14px" : "0px",
                    height: isFilled ? "14px" : "0px",
                    borderRadius: "9999px",
                    background: "#fff",
                    transition: "all 0.2s cubic-bezier(0.34, 1.56, 0.64, 1)",
                  }}
                />
              )}
            </div>
          );
        })}
      </div>

      {/* Off-screen input — captures keyboard */}
      <input
        ref={inputRef}
        type="tel"
        inputMode="numeric"
        pattern="[0-9]*"
        maxLength={PIN_LENGTH}
        value={value}
        onChange={handleInput}
        onKeyDown={handleKeyDown}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        disabled={disabled}
        tabIndex={-1}
        style={{
          position: "fixed",
          left: "-9999px",
          top: "-9999px",
          opacity: 0,
        }}
      />

      {/* Keyframe for shake animation */}
      <style>{`
        @keyframes pin-shake {
          0%, 100% { transform: translateX(0); }
          10%, 50%, 90% { transform: translateX(-6px); }
          30%, 70% { transform: translateX(6px); }
        }
      `}</style>
    </div>
  );
}

export function SearchInput({
  value,
  onChange,
  placeholder = "Search",
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <div style={{ padding: "8px 20px" }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          background: "rgba(0, 0, 0, 0.04)",
          borderRadius: "47px",
          padding: "0 16px",
          gap: "8px",
          height: "44px",
        }}
      >
        <Search
          size={24}
          style={{ color: "rgba(60, 60, 67, 0.6)", flexShrink: 0 }}
        />
        <input
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          style={{
            flex: 1,
            background: "none",
            border: "none",
            outline: "none",
            fontFamily: "var(--font-geist-sans), sans-serif",
            fontSize: "16px",
            fontWeight: 400,
            lineHeight: "20px",
            color: "#000",
            padding: 0,
          }}
          type="text"
          value={value}
        />
      </div>
    </div>
  );
}

export function SubViewHeader({
  title,
  onBack,
  onClose,
}: {
  title: string;
  onBack: () => void;
  onClose: () => void;
}) {
  return (
    <>
      <style>{`
        .subview-back:hover {
          background: rgba(0, 0, 0, 0.08) !important;
        }
        .subview-close:hover {
          background: rgba(0, 0, 0, 0.08) !important;
        }
      `}</style>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "8px",
        }}
      >
        <button
          className="subview-back"
          onClick={onBack}
          style={{
            width: "36px",
            height: "36px",
            display: "flex",
            justifyContent: "center",
            alignItems: "center",
            background: "rgba(0, 0, 0, 0.04)",
            border: "none",
            borderRadius: "9999px",
            cursor: "pointer",
            transition: "all 0.2s ease",
            color: "#3C3C43",
          }}
          type="button"
        >
          <ArrowLeft size={24} />
        </button>
        <span
          style={{
            fontFamily: "var(--font-geist-sans), sans-serif",
            fontSize: "18px",
            fontWeight: 600,
            lineHeight: "28px",
            color: "#000",
          }}
        >
          {title}
        </span>
        <button
          className="subview-close"
          onClick={onClose}
          style={{
            width: "36px",
            height: "36px",
            display: "flex",
            justifyContent: "center",
            alignItems: "center",
            background: "rgba(0, 0, 0, 0.04)",
            border: "none",
            borderRadius: "9999px",
            cursor: "pointer",
            transition: "all 0.2s ease",
            color: "#3C3C43",
          }}
          type="button"
        >
          <X size={24} />
        </button>
      </div>
    </>
  );
}
