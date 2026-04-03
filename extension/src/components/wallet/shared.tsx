import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowLeft, Eye, EyeOff, Search, X } from "lucide-react";

// ---------------------------------------------------------------------------
// Password Input — replaces PIN input for stronger wallet protection
// ---------------------------------------------------------------------------

export const MIN_PASSWORD_LENGTH = 6;

export function getPasswordStrength(
  password: string,
): { level: "weak" | "fair" | "strong"; label: string; color: string } {
  if (password.length === 0)
    return { level: "weak", label: "", color: "transparent" };
  if (password.length < MIN_PASSWORD_LENGTH)
    return { level: "weak", label: "Too short", color: "#FF3B30" };
  const hasLetter = /[a-zA-Z]/.test(password);
  const hasNumber = /\d/.test(password);
  const hasSpecial = /[^a-zA-Z0-9]/.test(password);
  const types = [hasLetter, hasNumber, hasSpecial].filter(Boolean).length;
  if (password.length >= 10 && types >= 2)
    return { level: "strong", label: "Strong", color: "#34C759" };
  if (password.length >= 8 || types >= 2)
    return { level: "fair", label: "Fair", color: "#FF9500" };
  return { level: "weak", label: "Weak", color: "#FF3B30" };
}

export function PasswordInput({
  value,
  onChange,
  onSubmit,
  error,
  errorMessage,
  disabled,
  label,
  showStrength,
  placeholder = "Enter password",
  autoFocus,
}: {
  value: string;
  onChange: (password: string) => void;
  onSubmit?: (password: string) => void;
  error?: boolean;
  errorMessage?: string;
  disabled?: boolean;
  label?: string;
  showStrength?: boolean;
  placeholder?: string;
  autoFocus?: boolean;
}) {
  const [visible, setVisible] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const [shake, setShake] = useState(false);

  useEffect(() => {
    if (error) {
      setShake(true);
      const t = setTimeout(() => setShake(false), 500);
      return () => clearTimeout(t);
    }
  }, [error]);

  useEffect(() => {
    if (autoFocus) inputRef.current?.focus();
  }, [autoFocus]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter" && value.length > 0 && onSubmit && !disabled) {
        onSubmit(value);
      }
    },
    [value, onSubmit, disabled],
  );

  const strength = showStrength ? getPasswordStrength(value) : null;

  return (
    <div
      style={{
        width: "100%",
        display: "flex",
        flexDirection: "column",
        gap: "8px",
        animation: shake ? "input-shake 0.5s ease" : undefined,
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

      <div style={{ position: "relative" }}>
        <input
          ref={inputRef}
          type={visible ? "text" : "password"}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={disabled}
          placeholder={placeholder}
          autoComplete="off"
          style={{
            width: "100%",
            height: "48px",
            padding: "0 44px 0 16px",
            fontFamily: "var(--font-geist-sans), sans-serif",
            fontSize: "16px",
            fontWeight: 400,
            lineHeight: "20px",
            color: "#000",
            background: "#fff",
            border: error
              ? "2px solid #FF3B30"
              : "2px solid rgba(0, 0, 0, 0.06)",
            borderRadius: "12px",
            outline: "none",
            boxSizing: "border-box",
            transition: "border-color 0.15s ease",
          }}
          onFocus={(e) => {
            e.target.style.borderColor = error ? "#FF3B30" : "#000";
          }}
          onBlur={(e) => {
            e.target.style.borderColor = error
              ? "#FF3B30"
              : "rgba(0, 0, 0, 0.06)";
          }}
        />
        <button
          type="button"
          onClick={() => setVisible(!visible)}
          tabIndex={-1}
          style={{
            position: "absolute",
            right: "12px",
            top: "50%",
            transform: "translateY(-50%)",
            background: "none",
            border: "none",
            cursor: "pointer",
            padding: "4px",
            color: "rgba(60, 60, 67, 0.4)",
            display: "flex",
            alignItems: "center",
          }}
        >
          {visible ? <EyeOff size={18} /> : <Eye size={18} />}
        </button>
      </div>

      {showStrength && strength && value.length > 0 && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "8px",
          }}
        >
          <div
            style={{
              flex: 1,
              height: "3px",
              borderRadius: "2px",
              background: "rgba(0, 0, 0, 0.06)",
              overflow: "hidden",
            }}
          >
            <div
              style={{
                height: "100%",
                borderRadius: "2px",
                background: strength.color,
                width:
                  strength.level === "weak"
                    ? "33%"
                    : strength.level === "fair"
                      ? "66%"
                      : "100%",
                transition: "width 0.2s ease, background 0.2s ease",
              }}
            />
          </div>
          <span
            style={{
              fontFamily: "var(--font-geist-sans), sans-serif",
              fontSize: "12px",
              fontWeight: 500,
              color: strength.color,
              minWidth: "60px",
            }}
          >
            {strength.label}
          </span>
        </div>
      )}

      {error && errorMessage && (
        <p
          style={{
            fontFamily: "var(--font-geist-sans), sans-serif",
            fontSize: "13px",
            lineHeight: "16px",
            color: "#FF3B30",
            margin: 0,
          }}
        >
          {errorMessage}
        </p>
      )}

      <style>{`
        @keyframes input-shake {
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
