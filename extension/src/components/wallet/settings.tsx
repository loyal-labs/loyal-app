import {
  ArrowLeft,
  Check,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  Copy,
  Eye,
  EyeOff,
  Globe,
  KeyRound,
  Lock,
  PanelRight,
  Plus,
  Square,
  Timer,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { useWalletContext } from "~/src/components/wallet/wallet-provider";
import { track, updateUserProfile } from "~/src/lib/analytics";
import {
  autoLockTimeout,
  viewMode as viewModeStorage,
} from "~/src/lib/storage";

import { PORTFOLIO_EVENTS } from "./portfolio-analytics";
import { SETTINGS_EVENTS } from "./settings-analytics";

const font = "var(--font-geist-sans), sans-serif";
const secondary = "rgba(60, 60, 67, 0.6)";
const chevronColor = "rgba(60, 60, 67, 0.3)";
const sectionBg = "#EBEBEB";
const sectionRadius = "16px";

// ---------------------------------------------------------------------------
// Reusable row component — matches app ProfileCell pattern
// ---------------------------------------------------------------------------

function SettingsRow({
  icon,
  title,
  detail,
  onClick,
  destructive,
  children,
}: {
  icon?: React.ReactNode;
  title: string;
  detail?: string;
  onClick?: () => void;
  destructive?: boolean;
  children?: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!onClick}
      style={{
        display: "flex",
        alignItems: "center",
        width: "100%",
        padding: "0 16px",
        background: "transparent",
        border: "none",
        cursor: onClick ? "pointer" : "default",
        textAlign: "left",
        transition: "background 0.1s ease",
      }}
      onMouseEnter={(e) => {
        if (onClick)
          (e.currentTarget as HTMLButtonElement).style.background =
            "rgba(0,0,0,0.04)";
      }}
      onMouseLeave={(e) => {
        (e.currentTarget as HTMLButtonElement).style.background = "transparent";
      }}
    >
      {icon && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            paddingRight: "10px",
            color: destructive ? "#FF3B30" : "rgba(0,0,0,0.6)",
          }}
        >
          {icon}
        </div>
      )}
      <div
        style={{
          flex: 1,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "10px 0",
          minWidth: 0,
          borderBottom: "0.5px solid rgba(0, 0, 0, 0.08)",
        }}
      >
        <span
          style={{
            fontFamily: font,
            fontSize: "14px",
            fontWeight: 400,
            lineHeight: "20px",
            color: destructive ? "#FF3B30" : "#000",
          }}
        >
          {title}
        </span>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "4px",
            paddingLeft: "12px",
            flexShrink: 0,
          }}
        >
          {detail && (
            <span
              style={{
                fontFamily: font,
                fontSize: "14px",
                fontWeight: 400,
                lineHeight: "20px",
                color: secondary,
              }}
            >
              {detail}
            </span>
          )}
          {children}
          {onClick && !children && (
            <ChevronRight size={14} style={{ color: chevronColor }} />
          )}
        </div>
      </div>
    </button>
  );
}

// ---------------------------------------------------------------------------
// Section wrapper — matches app SettingsSection
// ---------------------------------------------------------------------------

function Section({
  label,
  children,
}: {
  label?: string;
  children: React.ReactNode;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
      {label && (
        <span
          style={{
            fontFamily: font,
            fontSize: "12px",
            fontWeight: 500,
            lineHeight: "16px",
            color: secondary,
            textTransform: "uppercase",
            letterSpacing: "0.5px",
            paddingLeft: "16px",
          }}
        >
          {label}
        </span>
      )}
      <div
        style={{
          background: sectionBg,
          borderRadius: sectionRadius,
          paddingTop: "1px",
          paddingBottom: "1px",
          overflow: "hidden",
        }}
      >
        {children}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Segmented control for network / auto-lock
// ---------------------------------------------------------------------------

function SegmentedControl<T extends string | number>({
  options,
  value,
  onChange,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <div
      style={{
        display: "flex",
        gap: "4px",
        background: "rgba(0, 0, 0, 0.04)",
        borderRadius: "12px",
        padding: "4px",
        margin: "4px 12px 8px",
      }}
    >
      {options.map((opt) => (
        <button
          key={String(opt.value)}
          type="button"
          onClick={() => onChange(opt.value)}
          style={{
            flex: 1,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: "8px 0",
            borderRadius: "8px",
            border: "none",
            cursor: "pointer",
            fontFamily: font,
            fontSize: "13px",
            fontWeight: 500,
            lineHeight: "20px",
            background: value === opt.value ? "#fff" : "transparent",
            color: value === opt.value ? "#000" : secondary,
            boxShadow:
              value === opt.value ? "0 1px 3px rgba(0, 0, 0, 0.08)" : "none",
            transition:
              "background 0.15s ease, color 0.15s ease, box-shadow 0.15s ease",
            minWidth: 0,
          }}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main Settings component
// ---------------------------------------------------------------------------

export function Settings({ onBack }: { onBack: () => void }) {
  const { network, setNetwork, publicKey, lock, resetWallet, getSecretKey } =
    useWalletContext();
  const [showPrivateKey, setShowPrivateKey] = useState(false);
  const [revealKey, setRevealKey] = useState(false);
  const [copiedKey, setCopiedKey] = useState(false);
  const [copiedAddress, setCopiedAddress] = useState(false);
  const [resetAction, setResetAction] = useState<"create" | "import" | null>(
    null
  );
  const [lockTimeout, setLockTimeout] = useState(15);
  const [currentViewMode, setCurrentViewMode] = useState<"sidebar" | "popup">(
    "sidebar"
  );
  const [switchMessage, setSwitchMessage] = useState<string | null>(null);
  const [analyticsEnabled, setAnalyticsEnabled] = useState(true);

  useEffect(() => {
    void autoLockTimeout.getValue().then(setLockTimeout);
    void viewModeStorage.getValue().then(setCurrentViewMode);
  }, []);

  const handleCopyPrivateKey = useCallback(() => {
    const sk = getSecretKey();
    if (!sk) return;
    const hex = Array.from(sk)
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
    void navigator.clipboard.writeText(hex);
    setCopiedKey(true);
    setTimeout(() => setCopiedKey(false), 2000);
  }, [getSecretKey]);

  const truncatedKey = publicKey
    ? `${publicKey.slice(0, 4)}...${publicKey.slice(-4)}`
    : null;

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        flex: 1,
        minHeight: 0,
        background: "#F5F5F5",
        position: "relative",
        overflow: "hidden",
      }}
    >
      {/* Header */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "8px",
        }}
      >
        <button
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
            fontFamily: font,
            fontSize: "18px",
            fontWeight: 600,
            lineHeight: "28px",
            color: "#000",
          }}
        >
          Settings
        </span>
        <div style={{ width: "36px" }} />
      </div>

      {/* Scrollable content */}
      <div
        style={{
          flex: 1,
          minHeight: 0,
          overflowY: "auto",
          padding: "4px 12px 20px",
          display: "flex",
          flexDirection: "column",
          gap: "20px",
        }}
      >
        {/* ── Network ── */}
        <Section label="Network">
          <SegmentedControl
            options={[
              { value: "mainnet" as const, label: "Mainnet" },
              { value: "devnet" as const, label: "Devnet" },
            ]}
            value={network}
            onChange={(v) => {
              void setNetwork(v);
              track(SETTINGS_EVENTS.changeNetwork, { network: v });
              updateUserProfile({ network: v });
            }}
          />
        </Section>

        {/* ── Wallet ── */}
        <Section label="Wallet">
          {truncatedKey && (
            <SettingsRow
              icon={<Globe size={18} />}
              title="Address"
              detail={truncatedKey}
              onClick={() => {
                if (publicKey) {
                  void navigator.clipboard.writeText(publicKey);
                  setCopiedAddress(true);
                  setTimeout(() => setCopiedAddress(false), 1500);
                  track(PORTFOLIO_EVENTS.copyAddress, { source: "settings" });
                }
              }}
            >
              {copiedAddress ? (
                <Check size={14} style={{ color: "#34C759" }} />
              ) : (
                <Copy size={14} style={{ color: chevronColor }} />
              )}
            </SettingsRow>
          )}
          <SettingsRow
            icon={<Eye size={18} />}
            title="Private Key"
            onClick={() => {
              setShowPrivateKey(!showPrivateKey);
              setRevealKey(false);
            }}
          >
            {showPrivateKey ? (
              <ChevronUp size={14} style={{ color: chevronColor }} />
            ) : (
              <ChevronDown size={14} style={{ color: chevronColor }} />
            )}
          </SettingsRow>
          {showPrivateKey && (
            <div
              style={{
                margin: "0 12px 8px",
                background: "rgba(255, 59, 48, 0.06)",
                borderRadius: "12px",
                padding: "12px",
                display: "flex",
                flexDirection: "column",
                gap: "8px",
              }}
            >
              <span
                style={{
                  fontFamily: font,
                  fontSize: "12px",
                  lineHeight: "16px",
                  color: "#FF3B30",
                  textAlign: "center",
                }}
              >
                Never share your private key. Anyone with it has full access to
                your wallet.
              </span>
              <div
                style={{
                  position: "relative",
                  background: "rgba(0, 0, 0, 0.04)",
                  borderRadius: "8px",
                  padding: "10px 36px 10px 12px",
                  fontFamily: "monospace",
                  fontSize: "11px",
                  lineHeight: "16px",
                  color: "#000",
                  wordBreak: "break-all",
                  maxHeight: "80px",
                  overflowY: "auto",
                }}
              >
                {revealKey
                  ? Array.from(getSecretKey() ?? [])
                      .map((b) => b.toString(16).padStart(2, "0"))
                      .join("")
                  : "••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••"}
                <button
                  type="button"
                  onClick={() => {
                    if (!revealKey) {
                      track(SETTINGS_EVENTS.revealPrivateKey);
                    }
                    setRevealKey(!revealKey);
                  }}
                  style={{
                    position: "absolute",
                    right: "8px",
                    top: "50%",
                    transform: "translateY(-50%)",
                    background: "none",
                    border: "none",
                    cursor: "pointer",
                    padding: "2px",
                    display: "flex",
                    alignItems: "center",
                    color: "rgba(60, 60, 67, 0.6)",
                  }}
                >
                  {revealKey ? <EyeOff size={14} /> : <Eye size={14} />}
                </button>
              </div>
              <div style={{ display: "flex", gap: "8px" }}>
                <button
                  type="button"
                  onClick={handleCopyPrivateKey}
                  style={{
                    flex: 1,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: "6px",
                    padding: "8px 0",
                    borderRadius: "8px",
                    border: "none",
                    cursor: "pointer",
                    background: "#000",
                    fontFamily: font,
                    fontSize: "13px",
                    fontWeight: 500,
                    lineHeight: "16px",
                    color: "#fff",
                    transition: "background 0.15s ease",
                  }}
                >
                  {copiedKey ? <Check size={14} /> : <Copy size={14} />}
                  {copiedKey ? "Copied!" : "Copy"}
                </button>
                <button
                  type="button"
                  onClick={() => setShowPrivateKey(false)}
                  style={{
                    flex: 1,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    padding: "8px 0",
                    borderRadius: "8px",
                    border: "none",
                    cursor: "pointer",
                    background: "rgba(0, 0, 0, 0.04)",
                    fontFamily: font,
                    fontSize: "13px",
                    fontWeight: 500,
                    lineHeight: "16px",
                    color: "#000",
                    transition: "background 0.15s ease",
                  }}
                >
                  Hide
                </button>
              </div>
            </div>
          )}
          <SettingsRow
            icon={<Plus size={18} />}
            title="Create New Wallet"
            onClick={() => setResetAction("create")}
            destructive
          />
          <SettingsRow
            icon={<KeyRound size={18} />}
            title="Import Wallet"
            onClick={() => setResetAction("import")}
            destructive
          />

          {/* Confirmation card */}
          <div
            style={{
              maxHeight: resetAction ? "200px" : "0",
              opacity: resetAction ? 1 : 0,
              overflow: "hidden",
              transition:
                "max-height 0.3s cubic-bezier(0.4, 0, 0.2, 1), opacity 0.25s cubic-bezier(0.4, 0, 0.2, 1)",
            }}
          >
            <div
              style={{
                margin: "0 12px 8px",
                background: "#fff",
                borderRadius: "12px",
                border: "1px solid rgba(255, 59, 48, 0.2)",
                padding: "14px",
                display: "flex",
                flexDirection: "column",
                gap: "10px",
              }}
            >
              <span
                style={{
                  fontFamily: font,
                  fontSize: "13px",
                  fontWeight: 500,
                  lineHeight: "18px",
                  color: "#FF3B30",
                  textAlign: "center",
                }}
              >
                Your current wallet will be erased. Without an exported key you
                will lose access forever.
              </span>
              <div style={{ display: "flex", gap: "8px" }}>
                <button
                  type="button"
                  onClick={() => {
                    const action = resetAction;
                    setResetAction(null);
                    void resetWallet(action === "import" ? "import" : "create");
                  }}
                  style={{
                    flex: 1,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    padding: "8px 0",
                    border: "none",
                    borderRadius: "10px",
                    cursor: "pointer",
                    background: "rgba(255, 59, 48, 0.12)",
                    fontFamily: font,
                    fontSize: "13px",
                    fontWeight: 500,
                    lineHeight: "16px",
                    color: "#FF3B30",
                    transition: "background 0.15s ease",
                  }}
                >
                  I'm 100% sure
                </button>
                <button
                  type="button"
                  onClick={() => setResetAction(null)}
                  style={{
                    flex: 1,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    padding: "8px 0",
                    border: "none",
                    borderRadius: "10px",
                    cursor: "pointer",
                    background: "rgba(0, 0, 0, 0.04)",
                    fontFamily: font,
                    fontSize: "13px",
                    fontWeight: 500,
                    lineHeight: "16px",
                    color: "#000",
                    transition: "background 0.15s ease",
                  }}
                >
                  Nevermind
                </button>
              </div>
            </div>
          </div>
        </Section>

        {/* ── Extension ── */}
        <Section label="Extension">
          {!import.meta.env.FIREFOX && (
            <>
              <div style={{ padding: "0 16px" }}>
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    padding: "10px 0",
                    borderBottom: "0.5px solid rgba(0, 0, 0, 0.08)",
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "10px",
                    }}
                  >
                    {currentViewMode === "sidebar" ? (
                      <PanelRight
                        size={18}
                        style={{ color: "rgba(0,0,0,0.6)" }}
                      />
                    ) : (
                      <Square size={18} style={{ color: "rgba(0,0,0,0.6)" }} />
                    )}
                    <span
                      style={{
                        fontFamily: font,
                        fontSize: "14px",
                        fontWeight: 400,
                        lineHeight: "20px",
                        color: "#000",
                      }}
                    >
                      View Mode
                    </span>
                  </div>
                </div>
              </div>
              <SegmentedControl
                options={[
                  { value: "sidebar" as const, label: "Sidebar" },
                  { value: "popup" as const, label: "Popup" },
                ]}
                value={currentViewMode}
                onChange={(mode) => {
                  if (mode === currentViewMode) return;
                  setCurrentViewMode(mode);
                  void viewModeStorage.setValue(mode);
                  track(SETTINGS_EVENTS.changeViewMode, { view_mode: mode });
                  updateUserProfile({ view_mode: mode });
                  if (mode === "popup") {
                    // Background opens popup; close this view
                    setTimeout(() => globalThis.close(), 200);
                  } else {
                    // Can't open sidebar programmatically — show instruction
                    setSwitchMessage(
                      "Click the extension icon to open sidebar"
                    );
                  }
                }}
              />
            </>
          )}
          <SettingsRow
            icon={<Lock size={18} />}
            title="Lock Now"
            onClick={lock}
            destructive
          />
          <div style={{ padding: "0 16px" }}>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                padding: "10px 0",
                borderBottom: "0.5px solid rgba(0, 0, 0, 0.08)",
              }}
            >
              <div
                style={{ display: "flex", alignItems: "center", gap: "12px" }}
              >
                <Timer size={18} style={{ color: "rgba(0,0,0,0.6)" }} />
                <span
                  style={{
                    fontFamily: font,
                    fontSize: "14px",
                    fontWeight: 400,
                    lineHeight: "20px",
                    color: "#000",
                  }}
                >
                  Auto-Lock
                </span>
              </div>
            </div>
          </div>
          <SegmentedControl
            options={[
              { value: 5, label: "5m" },
              { value: 15, label: "15m" },
              { value: 30, label: "30m" },
              { value: 60, label: "1h" },
              { value: 0, label: "Never" },
            ]}
            value={lockTimeout}
            onChange={(v) => {
              setLockTimeout(v);
              void autoLockTimeout.setValue(v);
              track(SETTINGS_EVENTS.changeAutoLockTimeout, {
                timeout_minutes: v,
              });
            }}
          />
          <div style={{ padding: "0 16px" }}>
            <button
              type="button"
              onClick={() => setAnalyticsEnabled((v) => !v)}
              style={{
                display: "flex",
                alignItems: "center",
                gap: "12px",
                width: "100%",
                padding: "12px 0",
                background: "transparent",
                border: "none",
                cursor: "pointer",
                textAlign: "left",
              }}
            >
              <div
                style={{
                  width: "20px",
                  height: "20px",
                  borderRadius: "6px",
                  border: analyticsEnabled
                    ? "none"
                    : "1.5px solid rgba(60, 60, 67, 0.3)",
                  background: analyticsEnabled ? "#000" : "transparent",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  flexShrink: 0,
                  transition: "background 0.15s ease, border 0.15s ease",
                }}
              >
                {analyticsEnabled && (
                  <Check size={14} style={{ color: "#fff" }} />
                )}
              </div>
              <span
                style={{
                  fontFamily: font,
                  fontSize: "13px",
                  fontWeight: 400,
                  lineHeight: "18px",
                  color: secondary,
                }}
              >
                Help us improve Loyal through anonymous analytics
              </span>
            </button>
          </div>
        </Section>

        {/* Version */}
        <div style={{ textAlign: "center", paddingTop: "4px" }}>
          <span
            style={{
              fontFamily: font,
              fontSize: "12px",
              lineHeight: "16px",
              color: "rgba(60, 60, 67, 0.3)",
            }}
          >
            Loyal Extension v0.0.1
          </span>
        </div>
      </div>

      {/* Fullscreen overlay for sidebar switch prompt */}
      {switchMessage && (
        <div
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            width: "100vw",
            height: "100vh",
            background: "rgba(245, 245, 245, 0.75)",
            backdropFilter: "blur(12px)",
            WebkitBackdropFilter: "blur(12px)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 9999,
            padding: "0 24px",
          }}
        >
          <span
            style={{
              fontFamily: font,
              fontSize: "15px",
              fontWeight: 600,
              lineHeight: "22px",
              color: "#000",
              textAlign: "center",
            }}
          >
            Click the{" "}
            <img
              src="/icon/128.png"
              alt=""
              style={{
                width: "18px",
                height: "18px",
                verticalAlign: "-3px",
                display: "inline",
                margin: "0 2px",
              }}
            />{" "}
            extension icon to open sidebar
          </span>
        </div>
      )}
    </div>
  );
}
