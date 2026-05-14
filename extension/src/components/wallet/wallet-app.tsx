import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import lottie from "lottie-web/build/player/lottie_light";
import { usePopularTokens } from "~/src/hooks/use-popular-tokens";
import {
  ArrowDownLeft,
  ArrowLeftRight,
  ArrowUpRight,
  Check,
  Copy,
  Download,
  Eye,
  EyeOff,
  Settings as SettingsIcon,
  Shield,
  TriangleAlert,
  Wallet,
} from "lucide-react";
import shieldAnimationData from "~/assets/shield-animation.json";
import confettiAnimationData from "~/assets/confetti.json";
import type {
  SubView,
  SwapMode,
  SwapToken,
  TokenRow,
} from "@loyal-labs/wallet-core/types";
import { LOYL_TOKEN } from "@loyal-labs/wallet-core/types";
import bs58 from "bs58";
import { Keypair } from "@solana/web3.js";
import {
  generateKeypair,
  getPinLockoutRemaining,
  PinLockedError,
} from "~/src/lib/keypair-storage";
import { credentialVersion as credentialVersionStorage } from "~/src/lib/storage";
import { useWalletContext, WalletProvider } from "./wallet-provider";
import { FourDogsMark } from "./four-dogs-mark";
import { MIN_PASSWORD_LENGTH, PasswordInput } from "./shared";

import { PortfolioContent } from "./portfolio-content";
import type { TokenRowActions } from "./token-row-item";
import { SendContent } from "./send-content";
import { ReceiveContent } from "./receive-content";
import { SwapContent } from "./swap-content";
import { ShieldContent, SwapShieldTabs } from "./shield-content";

import { AllTokensView } from "./all-tokens-view";
import { AllActivityView } from "./all-activity-view";
import { TokenDetailView } from "./token-detail-view";
import { TokenSelectView } from "./token-select-view";
import { TransactionDetailView } from "./transaction-detail-view";
import { Settings } from "./settings";
import { DappApprovalView } from "./dapp-approval-view";
import { useWalletData } from "@loyal-labs/wallet-core/hooks";
import { getTokenIconUrl } from "@loyal-labs/wallet-core/lib";
import { useExtensionWalletDataClient } from "~/src/lib/wallet-data-client";
import { fetchPriceChanges } from "~/src/lib/coingecko";
import { pendingDappApproval, onboardingCompleted, confettiShown } from "~/src/lib/storage";
import { OnboardingScreen } from "./onboarding-screen";
import {
  flushInstallEvent,
  initAnalytics,
  identifyWallet,
  track,
  resetAnalytics,
} from "~/src/lib/analytics";
import { WALLET_SETUP_EVENTS } from "./wallet-setup-analytics";
import { PORTFOLIO_EVENTS } from "./portfolio-analytics";

// ---------------------------------------------------------------------------
// Default token constants
// ---------------------------------------------------------------------------

const SOL_TOKEN: SwapToken = {
  mint: "So11111111111111111111111111111111111111112",
  symbol: "SOL",
  icon: "https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/So11111111111111111111111111111111111111112/logo.png",
  price: 0,
  balance: 0,
};

// ---------------------------------------------------------------------------
// Tab definitions
// ---------------------------------------------------------------------------

const TABS = [
  { id: "portfolio", label: "Portfolio", Icon: Wallet },
  { id: "send", label: "Send", Icon: ArrowUpRight },
  { id: "receive", label: "Receive", Icon: ArrowDownLeft },
  { id: "swap", label: "Swap", Icon: ArrowLeftRight },
  { id: "shield", label: "Shield", Icon: Shield },
] as const;

type TabId = (typeof TABS)[number]["id"];

// ---------------------------------------------------------------------------
// 3-layer sliding navigation
// ---------------------------------------------------------------------------

function layerStyle(layer: number, activeLayer: number): React.CSSProperties {
  const transition =
    "transform 0.3s cubic-bezier(0.4, 0, 0.2, 1), opacity 0.25s cubic-bezier(0.4, 0, 0.2, 1)";
  if (layer > activeLayer) {
    // Off-screen to the right
    return {
      transform: "translateX(105%)",
      opacity: 0,
      pointerEvents: "none",
      transition,
    };
  }
  if (layer === activeLayer) {
    // Fully visible
    return {
      transform: "translateX(0)",
      opacity: 1,
      transition,
    };
  }
  // Behind the active layer — shift slightly left (matches frontend's -6px)
  return {
    transform: "translateX(-6px)",
    opacity: 1,
    pointerEvents: "none",
    transition,
  };
}

function getActiveLayer(subView: SubView): number {
  if (subView === null) return 0;
  if (typeof subView === "object" && subView.type === "transaction") {
    return 2;
  }
  return 1;
}

// ---------------------------------------------------------------------------
// Shared UI atoms
// ---------------------------------------------------------------------------

function ShieldAnimation({ size = 64 }: { size?: number }) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!containerRef.current) return;
    const anim = lottie.loadAnimation({
      container: containerRef.current,
      renderer: "svg",
      loop: false,
      autoplay: true,
      animationData: shieldAnimationData,
    });
    return () => anim.destroy();
  }, []);

  return <div ref={containerRef} style={{ width: size, height: size }} />;
}

function ConfettiOverlay({ onComplete }: { onComplete?: () => void }) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!containerRef.current) return;
    const anim = lottie.loadAnimation({
      container: containerRef.current,
      renderer: "svg",
      loop: false,
      autoplay: true,
      animationData: confettiAnimationData,
    });
    anim.addEventListener("complete", () => onComplete?.());
    return () => anim.destroy();
  }, [onComplete]);

  return (
    <div
      ref={containerRef}
      style={{
        position: "fixed",
        inset: 0,
        pointerEvents: "none",
        zIndex: 9999,
      }}
    />
  );
}

// ---------------------------------------------------------------------------
// Create / Import wallet screen
// ---------------------------------------------------------------------------

function CreateWalletScreen({
  initialMode = "create",
}: {
  initialMode?: "create" | "import";
}) {
  const { importWallet, finalizeSigner } = useWalletContext();
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [step, setStep] = useState<"enter" | "confirm">("enter");
  const [secretKeyInput, setSecretKeyInput] = useState("");
  const [showImportKey, setShowImportKey] = useState(false);
  const [mode, setMode] = useState<"create" | "import">(initialMode);
  const [error, setError] = useState<string | null>(null);
  const [keyError, setKeyError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [pendingKeypair, setPendingKeypair] = useState<Keypair | null>(null);
  const [copied, setCopied] = useState(false);

  const secretKeyHex = pendingKeypair
    ? Array.from(pendingKeypair.secretKey)
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("")
    : "";

  const handleGenerateKeypair = useCallback(async (finalPassword: string) => {
    setLoading(true);
    try {
      const keypair = await generateKeypair(finalPassword);
      await credentialVersionStorage.setValue(2);
      setPendingKeypair(keypair);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to create wallet");
    } finally {
      setLoading(false);
    }
  }, []);

  const handleCopyKey = useCallback(() => {
    void navigator.clipboard.writeText(secretKeyHex).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }, [secretKeyHex]);

  const handleDownloadKey = useCallback(() => {
    const blob = new Blob([secretKeyHex], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "loyal-wallet-key.txt";
    a.click();
    URL.revokeObjectURL(url);
  }, [secretKeyHex]);

  const handleBackupConfirmed = useCallback(() => {
    if (!pendingKeypair) return;
    identifyWallet(pendingKeypair.publicKey.toBase58(), "created");
    track(WALLET_SETUP_EVENTS.walletCreated);
    finalizeSigner(pendingKeypair);
  }, [pendingKeypair, finalizeSigner]);

  const handlePasswordSubmit = useCallback(
    (entered: string) => {
      if (entered.length < MIN_PASSWORD_LENGTH) {
        setError(`Password must be at least ${MIN_PASSWORD_LENGTH} characters`);
        return;
      }
      if (step === "enter") {
        setPassword(entered);
        setStep("confirm");
        setConfirmPassword("");
        setError(null);
      } else {
        if (entered !== password) {
          setError("Passwords don't match");
          setConfirmPassword("");
          return;
        }
        setConfirmPassword(entered);
        setError(null);
        if (mode === "import") return;
        void handleGenerateKeypair(entered);
      }
    },
    [step, password, mode, handleGenerateKeypair]
  );

  const handleImport = async () => {
    try {
      const trimmed = secretKeyInput.trim();
      if (!trimmed) throw new Error("Private key cannot be empty");

      let bytes: Uint8Array;
      const hex = trimmed.replace(/^0x/, "");
      if (/^[0-9a-fA-F]+$/.test(hex)) {
        const pairs = hex.match(/.{1,2}/g)!;
        bytes = new Uint8Array(pairs.map((b) => parseInt(b, 16)));
      } else {
        try {
          bytes = bs58.decode(trimmed);
        } catch {
          throw new Error("Invalid private key format");
        }
      }

      setKeyError(null);
      setLoading(true);
      await importWallet(bytes, password);
      await credentialVersionStorage.setValue(2);
      const importedKeypair = Keypair.fromSecretKey(bytes);
      identifyWallet(importedKeypair.publicKey.toBase58(), "imported");
      track(WALLET_SETUP_EVENTS.walletImported);
    } catch (e) {
      setKeyError(
        e instanceof Error ? e.message : "Invalid secret key or import failed"
      );
    } finally {
      setLoading(false);
    }
  };

  const handleBack = useCallback(() => {
    setStep("enter");
    setConfirmPassword("");
    setPassword("");
    setError(null);
    setKeyError(null);
  }, []);

  const showImportField =
    mode === "import" &&
    step === "confirm" &&
    confirmPassword === password &&
    confirmPassword.length >= MIN_PASSWORD_LENGTH;

  const showBackup = !!pendingKeypair;

  return (
    <div style={{ position: "relative", height: "100%", overflow: "hidden" }}>
      {/* PIN / create flow */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          padding: "0 20px",
          opacity: showBackup ? 0 : 1,
          transform: showBackup ? "translateX(-20px)" : "translateX(0)",
          pointerEvents: showBackup ? "none" : "auto",
          transition: "opacity 0.3s ease, transform 0.3s ease",
        }}
      >
        {/* Branding cluster */}
        <div style={{ marginBottom: "32px" }}>
          <FourDogsMark size={320} />
        </div>

        {/* Tab toggle */}
        <div
          style={{
            display: "flex",
            gap: "6px",
            width: "100%",
            marginBottom: "24px",
          }}
        >
          <button
            type="button"
            onClick={() => {
              setMode("create");
              setError(null);
              setStep("enter");
              setPassword("");
              setConfirmPassword("");
            }}
            style={{
              flex: 1,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              padding: "8px 0",
              borderRadius: "12px",
              border: "none",
              cursor: "pointer",
              fontFamily: "var(--font-geist-sans), sans-serif",
              fontSize: "14px",
              fontWeight: 500,
              lineHeight: "20px",
              background: mode === "create" ? "#000" : "rgba(0, 0, 0, 0.04)",
              color: mode === "create" ? "#fff" : "#000",
              transition: "background 0.15s ease, color 0.15s ease",
            }}
          >
            Create
          </button>
          <button
            type="button"
            onClick={() => {
              setMode("import");
              setError(null);
              setStep("enter");
              setPassword("");
              setConfirmPassword("");
            }}
            style={{
              flex: 1,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              padding: "8px 0",
              borderRadius: "12px",
              border: "none",
              cursor: "pointer",
              fontFamily: "var(--font-geist-sans), sans-serif",
              fontSize: "14px",
              fontWeight: 500,
              lineHeight: "20px",
              background: mode === "import" ? "#000" : "rgba(0, 0, 0, 0.04)",
              color: mode === "import" ? "#fff" : "#000",
              transition: "background 0.15s ease, color 0.15s ease",
            }}
          >
            Import
          </button>
        </div>

        {/* Password input */}
        <PasswordInput
          value={step === "enter" ? password : confirmPassword}
          onChange={step === "enter" ? setPassword : setConfirmPassword}
          onSubmit={handlePasswordSubmit}
          error={!!error}
          errorMessage={error ?? undefined}
          showStrength={step === "enter"}
          placeholder={
            step === "enter" ? "Create a password" : "Confirm your password"
          }
          autoFocus
        />

        {/* Continue button */}
        {!showImportField && (
          <button
            type="button"
            onClick={() => {
              const val = step === "enter" ? password : confirmPassword;
              if (val.length > 0) handlePasswordSubmit(val);
            }}
            disabled={
              loading ||
              (step === "enter" ? password : confirmPassword).length === 0
            }
            style={{
              width: "100%",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              padding: "12px 16px",
              marginTop: "16px",
              borderRadius: "9999px",
              border: "none",
              cursor:
                (step === "enter" ? password : confirmPassword).length === 0
                  ? "default"
                  : "pointer",
              background:
                (step === "enter" ? password : confirmPassword).length === 0
                  ? "#CCCDCD"
                  : "#000",
              fontFamily: "var(--font-geist-sans), sans-serif",
              fontSize: "16px",
              fontWeight: 400,
              lineHeight: "20px",
              color: "#fff",
              transition: "background 0.15s ease",
            }}
          >
            {loading ? "Working..." : step === "enter" ? "Continue" : "Confirm"}
          </button>
        )}

        {/* Back button — always rendered to reserve space and prevent layout shift */}
        <button
          type="button"
          onClick={handleBack}
          style={{
            marginTop: "8px",
            background: "none",
            border: "none",
            cursor: step === "confirm" ? "pointer" : "default",
            fontFamily: "var(--font-geist-sans), sans-serif",
            fontSize: "13px",
            fontWeight: 500,
            lineHeight: "16px",
            color: "rgba(60, 60, 67, 0.6)",
            padding: "4px 8px",
            opacity: step === "confirm" && !showImportField ? 1 : 0,
            pointerEvents:
              step === "confirm" && !showImportField ? "auto" : "none",
            transition: "opacity 0.15s ease",
          }}
        >
          Re-enter password
        </button>

        {/* Import key field + button — animated reveal after PIN is confirmed */}
        <div
          style={{
            width: "100%",
            overflow: "hidden",
            maxHeight: showImportField ? "350px" : "0px",
            opacity: showImportField ? 1 : 0,
            transition:
              "max-height 0.35s cubic-bezier(0.4, 0, 0.2, 1), opacity 0.3s ease",
          }}
        >
          <div style={{ width: "100%", marginTop: "16px" }}>
            <div style={{ position: "relative", width: "100%" }}>
              <textarea
                placeholder="Private key"
                value={secretKeyInput}
                onChange={(e) => {
                  setSecretKeyInput(e.target.value);
                  if (keyError) setKeyError(null);
                }}
                rows={4}
                style={{
                  width: "100%",
                  background: "#fff",
                  border: keyError
                    ? "2px solid #FF3B30"
                    : "2px solid transparent",
                  borderRadius: "16px",
                  padding: "12px 40px 12px 16px",
                  fontFamily: showImportKey
                    ? "monospace"
                    : "'text-security-disc', monospace",
                  fontSize: "13px",
                  fontWeight: 400,
                  lineHeight: "18px",
                  color: "#000",
                  outline: "none",
                  resize: "none",
                  boxSizing: "border-box",
                  wordBreak: "break-all",
                  transition: "border-color 0.15s ease",
                  ...(showImportKey
                    ? {}
                    : { WebkitTextSecurity: "disc" as never }),
                }}
              />
              <button
                type="button"
                onClick={() => setShowImportKey(!showImportKey)}
                style={{
                  position: "absolute",
                  right: "12px",
                  top: "12px",
                  background: "none",
                  border: "none",
                  cursor: "pointer",
                  padding: "2px",
                  display: "flex",
                  alignItems: "center",
                  color: "rgba(60, 60, 67, 0.6)",
                }}
              >
                {showImportKey ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
            {keyError && (
              <p
                style={{
                  fontFamily: "var(--font-geist-sans), sans-serif",
                  fontSize: "13px",
                  lineHeight: "16px",
                  color: "#FF3B30",
                  margin: "8px 0 0",
                }}
              >
                {keyError}
              </p>
            )}
          </div>

          {/* Import button */}
          {(() => {
            const isDisabled = loading || !secretKeyInput.trim();
            return (
              <button
                type="button"
                disabled={isDisabled}
                onClick={handleImport}
                style={{
                  width: "100%",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  padding: "12px 16px",
                  marginTop: "16px",
                  borderRadius: "9999px",
                  border: "none",
                  cursor: isDisabled ? "default" : "pointer",
                  background: isDisabled ? "#CCCDCD" : "#000",
                  fontFamily: "var(--font-geist-sans), sans-serif",
                  fontSize: "16px",
                  fontWeight: 400,
                  lineHeight: "20px",
                  color: "#fff",
                  textAlign: "center",
                  transition: "background 0.15s ease",
                }}
              >
                {loading ? "Working..." : "Import Wallet"}
              </button>
            );
          })()}
        </div>
      </div>

      {/* Backup key screen — slides in from right */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          padding: "0 20px",
          opacity: showBackup ? 1 : 0,
          transform: showBackup ? "translateX(0)" : "translateX(20px)",
          pointerEvents: showBackup ? "auto" : "none",
          transition: "opacity 0.3s ease, transform 0.3s ease",
        }}
      >
        {/* Warning icon */}
        <div
          style={{
            width: "56px",
            height: "56px",
            borderRadius: "16px",
            background: "rgba(255, 149, 0, 0.1)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            marginBottom: "16px",
          }}
        >
          <TriangleAlert size={28} style={{ color: "#FF9500" }} />
        </div>

        <span
          style={{
            fontFamily: "var(--font-geist-sans), sans-serif",
            fontSize: "18px",
            fontWeight: 600,
            lineHeight: "24px",
            color: "#000",
            textAlign: "center",
          }}
        >
          Back up your key
        </span>

        <span
          style={{
            fontFamily: "var(--font-geist-sans), sans-serif",
            fontSize: "13px",
            fontWeight: 400,
            lineHeight: "18px",
            color: "rgba(60, 60, 67, 0.6)",
            textAlign: "center",
            marginTop: "8px",
            maxWidth: "280px",
          }}
        >
          This is your only way to recover the wallet. Save it somewhere safe —
          if you lose it, your funds are gone forever.
        </span>

        {/* Key display */}
        <div style={{ width: "100%", marginTop: "20px", position: "relative" }}>
          <textarea
            readOnly
            value={secretKeyHex}
            rows={4}
            style={{
              width: "100%",
              background: "#fff",
              border: "none",
              borderRadius: "16px",
              padding: "12px 16px",
              fontFamily: "monospace",
              fontSize: "13px",
              fontWeight: 400,
              lineHeight: "18px",
              color: "#000",
              outline: "none",
              resize: "none",
              boxSizing: "border-box",
              wordBreak: "break-all",
            }}
          />
        </div>

        {/* Copy + Download buttons */}
        <div
          style={{
            display: "flex",
            gap: "8px",
            width: "100%",
            marginTop: "12px",
          }}
        >
          <button
            type="button"
            onClick={handleCopyKey}
            style={{
              flex: 1,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: "6px",
              padding: "10px 0",
              borderRadius: "12px",
              border: "none",
              cursor: "pointer",
              background: "rgba(0, 0, 0, 0.04)",
              fontFamily: "var(--font-geist-sans), sans-serif",
              fontSize: "14px",
              fontWeight: 500,
              lineHeight: "20px",
              color: "#000",
              transition: "background 0.15s ease",
            }}
          >
            {copied ? <Check size={16} /> : <Copy size={16} />}
            {copied ? "Copied" : "Copy"}
          </button>
          <button
            type="button"
            onClick={handleDownloadKey}
            style={{
              flex: 1,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: "6px",
              padding: "10px 0",
              borderRadius: "12px",
              border: "none",
              cursor: "pointer",
              background: "rgba(0, 0, 0, 0.04)",
              fontFamily: "var(--font-geist-sans), sans-serif",
              fontSize: "14px",
              fontWeight: 500,
              lineHeight: "20px",
              color: "#000",
              transition: "background 0.15s ease",
            }}
          >
            <Download size={16} />
            Download
          </button>
        </div>

        {/* Confirm button */}
        <button
          type="button"
          onClick={handleBackupConfirmed}
          style={{
            width: "100%",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: "12px 16px",
            marginTop: "20px",
            borderRadius: "9999px",
            border: "none",
            cursor: "pointer",
            background: "#000",
            fontFamily: "var(--font-geist-sans), sans-serif",
            fontSize: "16px",
            fontWeight: 400,
            lineHeight: "20px",
            color: "#fff",
            textAlign: "center",
            transition: "background 0.15s ease",
          }}
        >
          I backed up my key
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Unlock screen
// ---------------------------------------------------------------------------

function formatLockoutRemaining(ms: number): string {
  const totalSeconds = Math.ceil(ms / 1000);
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes < 60)
    return seconds > 0 ? `${minutes}m ${seconds}s` : `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return remainingMinutes > 0 ? `${hours}h ${remainingMinutes}m` : `${hours}h`;
}

function UnlockScreen() {
  const { unlock, publicKey, resetWallet } = useWalletContext();
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [lockoutRemaining, setLockoutRemaining] = useState(0);
  const [showForgot, setShowForgot] = useState(false);

  // Check lockout on mount and tick countdown
  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | null = null;

    void getPinLockoutRemaining().then((remaining) => {
      if (remaining > 0) {
        setLockoutRemaining(remaining);
        timer = setInterval(() => {
          setLockoutRemaining((prev) => {
            const next = prev - 1000;
            if (next <= 0) {
              if (timer) clearInterval(timer);
              return 0;
            }
            return next;
          });
        }, 1000);
      }
    });

    return () => {
      if (timer) clearInterval(timer);
    };
  }, []);

  function startLockoutCountdown(ms: number) {
    setLockoutRemaining(ms);
    const timer = setInterval(() => {
      setLockoutRemaining((prev) => {
        const next = prev - 1000;
        if (next <= 0) {
          clearInterval(timer);
          return 0;
        }
        return next;
      });
    }, 1000);
  }

  const handleUnlock = useCallback(
    async (entered: string) => {
      if (!entered) return;
      setError(null);
      setLoading(true);
      try {
        await unlock(entered);
        track(WALLET_SETUP_EVENTS.walletUnlocked);
      } catch (err) {
        if (err instanceof PinLockedError) {
          startLockoutCountdown(err.remainingMs);
          setError(null);
        } else {
          const remaining = await getPinLockoutRemaining();
          if (remaining > 0) {
            startLockoutCountdown(remaining);
          }
          setError("Wrong password");
        }
        setPassword("");
      } finally {
        setLoading(false);
      }
    },
    [unlock]
  );

  const truncatedKey = publicKey
    ? `${publicKey.slice(0, 4)}...${publicKey.slice(-4)}`
    : null;

  return (
    <div
      style={{
        position: "relative",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        height: "100%",
        padding: "0 20px",
        paddingBottom: "80px",
        overflow: "hidden",
      }}
    >
      {/* Branding cluster */}
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: "14px",
          marginBottom: "24px",
        }}
      >
        <FourDogsMark size={320} />
        {truncatedKey && (
          <span
            style={{
              fontFamily: "monospace",
              fontSize: "13px",
              lineHeight: "16px",
              color: "rgba(60, 60, 67, 0.6)",
            }}
          >
            {truncatedKey}
          </span>
        )}
      </div>

      {/* Password input */}
      <PasswordInput
        value={password}
        onChange={setPassword}
        onSubmit={handleUnlock}
        error={!!error}
        errorMessage={error ?? undefined}
        disabled={loading || lockoutRemaining > 0}
        label={
          lockoutRemaining > 0
            ? `Try again in ${formatLockoutRemaining(lockoutRemaining)}`
            : undefined
        }
        placeholder="Enter your password or PIN"
        autoFocus
      />

      <button
        type="button"
        onClick={() => {
          if (password.length > 0) void handleUnlock(password);
        }}
        disabled={loading || lockoutRemaining > 0 || password.length === 0}
        style={{
          width: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: "12px 16px",
          marginTop: "16px",
          borderRadius: "9999px",
          border: "none",
          cursor:
            loading || lockoutRemaining > 0 || password.length === 0
              ? "default"
              : "pointer",
          background:
            loading || lockoutRemaining > 0 || password.length === 0
              ? "#CCCDCD"
              : "#000",
          fontFamily: "var(--font-geist-sans), sans-serif",
          fontSize: "16px",
          fontWeight: 400,
          lineHeight: "20px",
          color: "#fff",
          transition: "background 0.15s ease",
        }}
      >
        {loading ? "Unlocking..." : "Unlock"}
      </button>

      {/* Forgot password link */}
      <button
        type="button"
        onClick={() => setShowForgot(true)}
        style={{
          marginTop: "24px",
          background: "none",
          border: "none",
          cursor: "pointer",
          fontFamily: "var(--font-geist-sans), sans-serif",
          fontSize: "13px",
          fontWeight: 500,
          lineHeight: "16px",
          color: "rgba(60, 60, 67, 0.6)",
          padding: "4px 8px",
        }}
      >
        Forgot password?
      </button>

      {/* Forgot password overlay */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          padding: "0 20px",
          background: "#F5F5F5",
          opacity: showForgot ? 1 : 0,
          transform: showForgot ? "translateX(0)" : "translateX(20px)",
          pointerEvents: showForgot ? "auto" : "none",
          transition: "opacity 0.25s ease, transform 0.25s ease",
        }}
      >
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: "12px",
            maxWidth: "320px",
          }}
        >
          <TriangleAlert
            size={48}
            style={{ color: "rgba(60, 60, 67, 0.3)" }}
          />
          <h2
            style={{
              fontFamily: "var(--font-geist-sans), sans-serif",
              fontSize: "22px",
              fontWeight: 600,
              lineHeight: "28px",
              color: "#000",
              margin: 0,
              textAlign: "center",
            }}
          >
            Forgot password
          </h2>
          <p
            style={{
              fontFamily: "var(--font-geist-sans), sans-serif",
              fontSize: "14px",
              fontWeight: 400,
              lineHeight: "20px",
              color: "rgba(60, 60, 67, 0.6)",
              margin: 0,
              textAlign: "center",
            }}
          >
            To reset your password, you will need to reset your wallet. Loyal
            cannot recover your password for you.
          </p>
          <p
            style={{
              fontFamily: "var(--font-geist-sans), sans-serif",
              fontSize: "13px",
              fontWeight: 500,
              lineHeight: "18px",
              color: "#FF3B30",
              margin: "4px 0 0",
              textAlign: "center",
            }}
          >
            Make sure you have your private key before proceeding. Without it,
            you will lose access to this wallet forever.
          </p>
        </div>

        <div
          style={{
            width: "100%",
            display: "flex",
            flexDirection: "column",
            gap: "8px",
            marginTop: "32px",
          }}
        >
          <button
            type="button"
            onClick={() => {
              setShowForgot(false);
              track(WALLET_SETUP_EVENTS.walletReset, {
                new_mode: "import",
              });
              resetAnalytics();
              void resetWallet("import");
            }}
            style={{
              width: "100%",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              padding: "12px 16px",
              borderRadius: "9999px",
              border: "none",
              cursor: "pointer",
              background: "#FF3B30",
              fontFamily: "var(--font-geist-sans), sans-serif",
              fontSize: "16px",
              fontWeight: 500,
              lineHeight: "20px",
              color: "#fff",
              transition: "background 0.15s ease",
            }}
          >
            Reset wallet
          </button>
          <button
            type="button"
            onClick={() => setShowForgot(false)}
            style={{
              width: "100%",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              padding: "12px 16px",
              borderRadius: "9999px",
              border: "none",
              cursor: "pointer",
              background: "transparent",
              fontFamily: "var(--font-geist-sans), sans-serif",
              fontSize: "16px",
              fontWeight: 400,
              lineHeight: "20px",
              color: "rgba(60, 60, 67, 0.6)",
              transition: "background 0.15s ease",
            }}
          >
            Go back
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main wallet interface (unlocked state)
// ---------------------------------------------------------------------------

function WalletInterface() {
  const { balanceHidden, toggleBalanceHidden, publicKey, signer, network } =
    useWalletContext();
  const solanaEnv = network as import("@loyal-labs/solana-rpc").SolanaEnv;
  const walletPubkey = signer?.publicKey ?? null;
  const walletDataClient = useExtensionWalletDataClient(
    solanaEnv,
    walletPubkey
  );
  const walletData = useWalletData({
    publicKey: walletPubkey,
    connected: !!signer,
    client: walletDataClient,
    solanaEnv,
  });

  // Navigation state
  const [activeTab, setActiveTab] = useState<TabId>("portfolio");
  const [subView, setSubView] = useState<SubView>(null);
  const [swapMode, setSwapMode] = useState<SwapMode>("swap");
  const [fromToken, setFromToken] = useState<SwapToken>(SOL_TOKEN);
  const [toToken, setToToken] = useState<SwapToken>(LOYL_TOKEN);
  const [sendToken, setSendToken] = useState<SwapToken>(SOL_TOKEN);
  const [shieldToken, setShieldToken] = useState<SwapToken>(SOL_TOKEN);
  const [showSettings, setShowSettings] = useState(false);
  const [activeDappApprovalNonce, setActiveDappApprovalNonce] = useState<
    string | null
  >(null);

  // Watch for pending dApp approval requests from storage
  useEffect(() => {
    function applyApprovalRequest(
      req: Awaited<ReturnType<typeof pendingDappApproval.getValue>>
    ) {
      if (!req) {
        setActiveDappApprovalNonce(null);
        return;
      }
      setActiveDappApprovalNonce(req.nonce);
      if (req.kind === "connect") {
        setSubView({
          type: "dappConnect",
          origin: req.origin,
          favicon: req.favicon,
          requestId: req.id,
        });
      } else {
        setSubView({
          type: "dappSign",
          origin: req.origin,
          favicon: req.favicon,
          requestId: req.id,
          kind: req.kind,
          transactionBase64: req.transaction,
          messageBase64: req.message,
        });
      }
    }

    // Check current value on mount
    void pendingDappApproval.getValue().then(applyApprovalRequest);

    // Watch for changes
    const unwatch = pendingDappApproval.watch(applyApprovalRequest);

    return unwatch;
  }, []);

  const sendDappApprovalDecision = useCallback(
    (requestId: string, approved: boolean) => {
      if (!activeDappApprovalNonce) return;
      void browser.runtime.sendMessage({
        type: "DAPP_APPROVAL_DECISION",
        id: requestId,
        nonce: activeDappApprovalNonce,
        approved,
      });
    },
    [activeDappApprovalNonce]
  );

  const activeLayer = getActiveLayer(subView);

  // Cross-fade when switching tabs: fade out → swap content → fade in
  const [crossFadeOpacity, setCrossFadeOpacity] = useState(1);
  const [displayTab, setDisplayTab] = useState(activeTab);
  useEffect(() => {
    if (activeTab !== displayTab) {
      setCrossFadeOpacity(0); // fade out
      const t = setTimeout(() => {
        setDisplayTab(activeTab); // swap content while near-invisible
        setCrossFadeOpacity(1); // fade in
      }, 100);
      return () => clearTimeout(t);
    }
  }, [activeTab, displayTab]);

  const handleTabChange = useCallback((tab: TabId) => {
    const eventMap: Partial<Record<TabId, string>> = {
      send: PORTFOLIO_EVENTS.openSend,
      receive: PORTFOLIO_EVENTS.openReceive,
      swap: PORTFOLIO_EVENTS.openSwap,
      shield: PORTFOLIO_EVENTS.openShield,
    };
    const event = eventMap[tab];
    if (event) track(event);
    setActiveTab(tab);
    setSubView(null);
  }, []);

  const handleSwapModeChange = useCallback((mode: SwapMode) => {
    setSwapMode(mode);
    setActiveTab(mode === "shield" ? "shield" : "swap");
    setSubView(null);
  }, []);

  const goBack = useCallback(() => {
    setSubView((current) => {
      if (current === null) return null;
      if (typeof current === "object" && current.type === "transaction") {
        if (current.from === "allActivity") return "allActivity";
        if (current.from === "allTokens") return "allTokens";
        return null;
      }
      if (typeof current === "object" && current.type === "tokenDetail") {
        return current.from === "allTokens" ? "allTokens" : null;
      }
      return null;
    });
  }, []);

  const handleNavigate = useCallback((view: SubView) => {
    setSubView(view);
  }, []);

  const handleDone = useCallback(() => {
    setActiveTab("portfolio");
    setSubView(null);
  }, []);

  // In the extension, "close" goes back to portfolio (no sidebar to dismiss)
  const handleClose = useCallback(() => {
    setActiveTab("portfolio");
    setSubView(null);
  }, []);

  const {
    walletAddress,
    isLoading,
    balanceWhole,
    balanceFraction,
    balanceSolLabel,
    walletLabel,
    tokenRows,
    allTokenRows,
    activityRows,
    allActivityRows,
    transactionDetails,
    positions,
    addLocalActivity,
  } = walletData;

  // Enrich token rows with 24h price change from CoinGecko
  const [priceChanges, setPriceChanges] = useState<Record<string, number>>({});
  useEffect(() => {
    const mints = allTokenRows.map((t) => t.id).filter((id): id is string => !!id);
    if (mints.length === 0) return;
    let cancelled = false;
    void fetchPriceChanges(mints).then((changes) => {
      if (!cancelled) setPriceChanges(changes);
    });
    return () => { cancelled = true; };
  }, [allTokenRows]);

  const enrichedTokenRows = useMemo(() => {
    if (Object.keys(priceChanges).length === 0) return allTokenRows;
    return allTokenRows.map((row) => {
      if (!row.id) return row;
      const mint = row.id.replace(/-secured$/, "");
      const change = priceChanges[mint];
      return change !== undefined ? { ...row, priceChange24h: change } : row;
    });
  }, [allTokenRows, priceChanges]);

  const enrichedPortfolioRows = useMemo(() => {
    if (Object.keys(priceChanges).length === 0) return tokenRows;
    return tokenRows.map((row) => {
      if (!row.id) return row;
      const mint = row.id.replace(/-secured$/, "");
      const change = priceChanges[mint];
      return change !== undefined ? { ...row, priceChange24h: change } : row;
    });
  }, [tokenRows, priceChanges]);

  // Convert allTokenRows to SwapToken[] for token-select views
  const swapTokens: SwapToken[] = positions.map((p) => ({
    mint: p.asset.mint,
    symbol: p.asset.symbol,
    icon: p.asset.imageUrl || getTokenIconUrl(p.asset.symbol),
    price: p.priceUsd ?? 0,
    balance: p.totalBalance,
  }));

  // Shield token list — one entry per balance variant (liquid + shielded).
  // Direction is derived from the selected token's `isSecured` flag.
  const shieldTokens = useMemo<SwapToken[]>(
    () =>
      positions.flatMap((p) => {
        const base = {
          mint: p.asset.mint,
          symbol: p.asset.symbol,
          icon: p.asset.imageUrl || getTokenIconUrl(p.asset.symbol),
          price: p.priceUsd ?? 0,
        };
        const entries: SwapToken[] = [];
        if (p.publicBalance > 0 || p.securedBalance <= 0) {
          entries.push({ ...base, balance: p.publicBalance, isSecured: false });
        }
        if (p.securedBalance > 0) {
          entries.push({ ...base, balance: p.securedBalance, isSecured: true });
        }
        return entries;
      }),
    [positions]
  );

  // Merge user's held tokens with popular tokens for swap target selection
  const { tokens: popularTokens, search: searchTokens } = usePopularTokens();
  const swapTargetTokens = useMemo<SwapToken[]>(() => {
    const heldMints = new Set(swapTokens.map((t) => t.mint).filter(Boolean));
    const extras = popularTokens.filter(
      (t) => t.mint && !heldMints.has(t.mint)
    );
    return [...swapTokens, ...extras];
  }, [swapTokens, popularTokens]);

  // Sync token state when real positions load
  useEffect(() => {
    if (swapTokens.length > 0 && swapTokens[0].mint) {
      setFromToken(swapTokens[0]);
      setSendToken(swapTokens[0]);
      if (shieldTokens.length > 0) {
        setShieldToken(shieldTokens[0]);
      }
      setToToken(
        swapTokens.find((t) => t.mint === LOYL_TOKEN.mint) ?? LOYL_TOKEN
      );
    }
  }, [positions.length]);

  const getTokenActions = useCallback(
    (token: TokenRow): TokenRowActions | undefined => {
      const isLoyal = token.id === LOYL_TOKEN.mint || token.symbol === "LOYAL";
      const isSecured = token.isSecured === true;

      const pickShieldTokenVariant = (wantSecured: boolean) => {
        const match = shieldTokens.find(
          (t) => t.mint === token.id && t.isSecured === wantSecured
        );
        if (match) setShieldToken(match);
      };

      if (isSecured) {
        return {
          onSend: () => handleTabChange("send"),
          onUnshield: () => {
            pickShieldTokenVariant(true);
            setSwapMode("shield");
            handleTabChange("shield");
          },
        };
      }

      const actions: TokenRowActions = {
        onSend: () => handleTabChange("send"),
        onSwap: () => {
          setSwapMode("swap");
          handleTabChange("swap");
        },
        onShield: () => {
          pickShieldTokenVariant(false);
          setSwapMode("shield");
          handleTabChange("shield");
        },
      };

      if (isLoyal) {
        actions.onBuy = () => {
          globalThis.open(
            `https://jup.ag/tokens/${LOYL_TOKEN.mint}`,
            "_blank",
            "noopener,noreferrer"
          );
        };
      }

      return actions;
    },
    [handleTabChange, setSwapMode, shieldTokens]
  );

  // Tab content with real components (uses displayTab for cross-fade)
  const renderTabContent = () => {
    switch (displayTab) {
      case "portfolio":
        return (
          <PortfolioContent
            activityRows={activityRows}
            balanceFraction={balanceFraction}
            balanceSolLabel={balanceSolLabel}
            balanceWhole={balanceWhole}
            isBalanceHidden={balanceHidden}
            isLoading={isLoading}
            onBalanceHiddenChange={() => void toggleBalanceHidden()}
            onNavigate={handleNavigate}
            onSend={() => handleTabChange("send")}
            onReceive={() => handleTabChange("receive")}
            onSwap={() => {
              setSwapMode("swap");
              handleTabChange("swap");
            }}
            onShield={() => {
              setSwapMode("shield");
              handleTabChange("shield");
            }}
            onSettings={() => setShowSettings(true)}
            tokenRows={enrichedPortfolioRows}
            transactionDetails={transactionDetails}
            walletAddress={walletAddress}
            walletLabel={walletLabel}
            getTokenActions={getTokenActions}
            onTokenDetail={(token) => handleNavigate({ type: "tokenDetail", token, from: "portfolio" })}
            onShieldUsdc={() => {
              const usdc = shieldTokens.find(
                (t) => t.symbol === "USDC" && !t.isSecured
              );
              if (usdc) setShieldToken(usdc);
              setSwapMode("shield");
              handleTabChange("shield");
            }}
            totalTokenCount={enrichedTokenRows.length}
            totalActivityCount={allActivityRows.length}
          />
        );
      case "send":
        return (
          <SendContent
            token={sendToken}
            onClose={handleClose}
            onNavigate={handleNavigate}
            onDone={handleDone}
            addLocalActivity={addLocalActivity}
          />
        );
      case "receive":
        return (
          <ReceiveContent walletAddress={walletAddress} onClose={handleClose} />
        );
      case "swap":
        return (
          <SwapContent
            fromToken={fromToken}
            toToken={toToken}
            onFromTokenChange={setFromToken}
            onToTokenChange={setToToken}
            onClose={handleClose}
            onNavigate={handleNavigate}
            onDone={handleDone}
            swapMode={swapMode}
            onSwapModeChange={handleSwapModeChange}
          />
        );
      case "shield":
        return (
          <ShieldContent
            token={shieldToken}
            onClose={handleClose}
            onNavigate={handleNavigate}
            onDone={handleDone}
            swapMode={swapMode}
            onSwapModeChange={handleSwapModeChange}
          />
        );
    }
  };

  // Sub-view content (layer 1)
  const renderSubView = () => {
    if (subView === null) return null;

    if (typeof subView === "string") {
      if (subView === "allTokens") {
        return (
          <AllTokensView
            tokens={enrichedTokenRows}
            isBalanceHidden={balanceHidden}
            onBack={goBack}
            onClose={handleClose}
            getTokenActions={getTokenActions}
            onTokenDetail={(token) => handleNavigate({ type: "tokenDetail", token, from: "allTokens" })}
          />
        );
      }
      if (subView === "allActivity") {
        return (
          <AllActivityView
            activities={allActivityRows}
            details={transactionDetails}
            isBalanceHidden={balanceHidden}
            onBack={goBack}
            onClose={handleClose}
            onNavigate={handleNavigate}
          />
        );
      }
      return null;
    }

    if (subView.type === "tokenDetail") {
      const t = subView.token;
      const actions = getTokenActions(t);
      const asSwapToken: SwapToken = swapTokens.find((s) => s.mint === t.id) ?? {
        mint: t.id,
        symbol: t.symbol,
        icon: t.icon,
        price: parseFloat(t.price) || 0,
        balance: parseFloat(t.amount) || 0,
        isSecured: t.isSecured,
      };
      return (
        <TokenDetailView
          token={t}
          onBack={goBack}
          onClose={handleClose}
          onSend={() => {
            setSendToken(asSwapToken);
            handleTabChange("send");
            setSubView(null);
          }}
          onReceive={() => {
            handleTabChange("receive");
            setSubView(null);
          }}
          onSwap={() => {
            setFromToken(asSwapToken);
            setSwapMode("swap");
            handleTabChange("swap");
            setSubView(null);
          }}
          onShield={(actions?.onShield || actions?.onUnshield) ? () => {
            actions.onShield?.(t) ?? actions.onUnshield?.(t);
            setSubView(null);
          } : undefined}
        />
      );
    }

    if (subView.type === "tokenSelect") {
      return (
        <TokenSelectView
          title={subView.field === "from" ? "Pay with" : "Receive"}
          currentToken={subView.field === "from" ? fromToken : toToken}
          onSelect={(token) => {
            if (subView.field === "from") {
              setFromToken(token);
            } else {
              setToToken(token);
            }
            setSubView(null);
          }}
          onBack={goBack}
          onClose={handleClose}
          onSearch={subView.field === "to" ? searchTokens : undefined}
          tokens={subView.field === "to" ? swapTargetTokens : swapTokens}
        />
      );
    }

    if (subView.type === "sendTokenSelect") {
      return (
        <TokenSelectView
          title="Send token"
          currentToken={sendToken}
          onSelect={(token) => {
            setSendToken(token);
            setSubView(null);
          }}
          onBack={goBack}
          onClose={handleClose}
          tokens={swapTokens}
        />
      );
    }

    if (subView.type === "shieldTokenSelect") {
      return (
        <TokenSelectView
          title="Select token"
          currentToken={shieldToken}
          onSelect={(token) => {
            setShieldToken(token);
            setSubView(null);
          }}
          onBack={goBack}
          onClose={handleClose}
          tokens={shieldTokens}
        />
      );
    }

    if (subView.type === "dappConnect") {
      return (
        <DappApprovalView
          kind="connect"
          origin={subView.origin}
          favicon={subView.favicon}
          onDeny={() => {
            sendDappApprovalDecision(subView.requestId, false);
            setActiveDappApprovalNonce(null);
            setSubView(null);
          }}
          onApprove={() => {
            sendDappApprovalDecision(subView.requestId, true);
            setActiveDappApprovalNonce(null);
            setSubView(null);
          }}
          onClose={() => {
            sendDappApprovalDecision(subView.requestId, false);
            setActiveDappApprovalNonce(null);
            setSubView(null);
          }}
        />
      );
    }

    if (subView.type === "dappSign") {
      return (
        <DappApprovalView
          kind={subView.kind}
          origin={subView.origin}
          favicon={subView.favicon}
          transactionBase64={subView.transactionBase64}
          messageBase64={subView.messageBase64}
          onDeny={() => {
            sendDappApprovalDecision(subView.requestId, false);
            setActiveDappApprovalNonce(null);
            setSubView(null);
          }}
          onApprove={() => {
            sendDappApprovalDecision(subView.requestId, true);
            setActiveDappApprovalNonce(null);
            setSubView(null);
          }}
          onClose={() => {
            sendDappApprovalDecision(subView.requestId, false);
            setActiveDappApprovalNonce(null);
            setSubView(null);
          }}
        />
      );
    }

    return null;
  };

  // Transaction detail content (layer 2)
  const renderTransactionDetail = () => {
    if (
      subView === null ||
      typeof subView === "string" ||
      subView.type !== "transaction"
    ) {
      return null;
    }
    return (
      <TransactionDetailView
        detail={subView.detail}
        onBack={goBack}
        onClose={handleClose}
      />
    );
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      {/* Navigation layers container */}
      <div style={{ position: "relative", flex: 1, overflow: "hidden" }}>
        {/* Layer 0 — main tab content with cross-fade */}
        <div
          style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            flexDirection: "column",
            background: activeLayer >= 1 ? "#EBEBEB" : "#F5F5F5",
            borderRadius: "20px",
            overflow: "clip",
            transition: "background 0.3s cubic-bezier(0.4, 0, 0.2, 1)",
            ...layerStyle(0, activeLayer),
          }}
        >
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              flex: 1,
              minHeight: 0,
              opacity: crossFadeOpacity,
              transition: "opacity 0.12s cubic-bezier(0.4, 0, 0.2, 1)",
            }}
          >
            {renderTabContent()}
          </div>
        </div>

        {/* Layer 1 — sub-views */}
        <div
          style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            flexDirection: "column",
            background: activeLayer >= 2 ? "#EBEBEB" : "#F5F5F5",
            borderRadius: "20px",
            overflow: "clip",
            transition: "background 0.3s cubic-bezier(0.4, 0, 0.2, 1)",
            ...layerStyle(1, activeLayer),
          }}
        >
          {renderSubView()}
        </div>

        {/* Layer 2 — transaction detail */}
        <div
          style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            flexDirection: "column",
            background: "#F5F5F5",
            ...layerStyle(2, activeLayer),
          }}
        >
          {renderTransactionDetail()}
        </div>

        {/* Settings overlay */}
        <div
          style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            flexDirection: "column",
            background: "#F5F5F5",
            borderRadius: "20px",
            overflow: "clip",
            transform: showSettings ? "translateX(0)" : "translateX(105%)",
            opacity: showSettings ? 1 : 0,
            transition:
              "transform 0.3s cubic-bezier(0.4, 0, 0.2, 1), opacity 0.25s cubic-bezier(0.4, 0, 0.2, 1)",
            pointerEvents: showSettings ? "auto" : "none",
          }}
        >
          <Settings onBack={() => setShowSettings(false)} />
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Password upgrade screen — shown after unlock for legacy PIN users
// ---------------------------------------------------------------------------

function PasswordUpgradeScreen({ onComplete }: { onComplete: () => void }) {
  const { changePassword } = useWalletContext();
  const [newPassword, setNewPassword] = useState("");
  const [confirmNewPassword, setConfirmNewPassword] = useState("");
  const [step, setStep] = useState<"enter" | "confirm">("enter");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = useCallback(
    async (entered: string) => {
      if (entered.length < MIN_PASSWORD_LENGTH) {
        setError(`Password must be at least ${MIN_PASSWORD_LENGTH} characters`);
        return;
      }
      if (step === "enter") {
        setNewPassword(entered);
        setStep("confirm");
        setConfirmNewPassword("");
        setError(null);
      } else {
        if (entered !== newPassword) {
          setError("Passwords don't match");
          setConfirmNewPassword("");
          return;
        }
        setLoading(true);
        try {
          await changePassword(entered);
          await credentialVersionStorage.setValue(2);
          onComplete();
        } catch (e) {
          setError(
            e instanceof Error ? e.message : "Failed to update password"
          );
        } finally {
          setLoading(false);
        }
      }
    },
    [step, newPassword, changePassword, onComplete]
  );

  const currentValue = step === "enter" ? newPassword : confirmNewPassword;

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        height: "100%",
        padding: "0 20px",
      }}
    >
      <div
        style={{
          width: "56px",
          height: "56px",
          borderRadius: "16px",
          background: "rgba(255, 149, 0, 0.1)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          marginBottom: "16px",
        }}
      >
        <Shield size={28} style={{ color: "#FF9500" }} />
      </div>

      <span
        style={{
          fontFamily: "var(--font-geist-sans), sans-serif",
          fontSize: "18px",
          fontWeight: 600,
          lineHeight: "24px",
          color: "#000",
          textAlign: "center",
        }}
      >
        Upgrade to password
      </span>
      <p
        style={{
          fontFamily: "var(--font-geist-sans), sans-serif",
          fontSize: "14px",
          lineHeight: "20px",
          color: "rgba(60, 60, 67, 0.6)",
          textAlign: "center",
          marginTop: "8px",
          marginBottom: "24px",
        }}
      >
        Your wallet uses a short PIN. Set a password for stronger protection.
      </p>

      <PasswordInput
        value={currentValue}
        onChange={step === "enter" ? setNewPassword : setConfirmNewPassword}
        onSubmit={handleSubmit}
        error={!!error}
        errorMessage={error ?? undefined}
        showStrength={step === "enter"}
        placeholder={
          step === "enter" ? "Enter new password" : "Re-enter your password"
        }
        autoFocus
      />

      <button
        type="button"
        onClick={() => {
          if (currentValue.length > 0) void handleSubmit(currentValue);
        }}
        disabled={loading || currentValue.length === 0}
        style={{
          width: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: "12px 16px",
          marginTop: "16px",
          borderRadius: "9999px",
          border: "none",
          cursor: currentValue.length === 0 ? "default" : "pointer",
          background: currentValue.length === 0 ? "#CCCDCD" : "#000",
          fontFamily: "var(--font-geist-sans), sans-serif",
          fontSize: "16px",
          fontWeight: 400,
          lineHeight: "20px",
          color: "#fff",
          transition: "background 0.15s ease",
        }}
      >
        {loading
          ? "Updating..."
          : step === "enter"
          ? "Continue"
          : "Set Password"}
      </button>

      {step === "confirm" && (
        <button
          type="button"
          onClick={() => {
            setStep("enter");
            setConfirmNewPassword("");
            setError(null);
          }}
          style={{
            marginTop: "8px",
            background: "none",
            border: "none",
            cursor: "pointer",
            fontFamily: "var(--font-geist-sans), sans-serif",
            fontSize: "13px",
            fontWeight: 500,
            lineHeight: "16px",
            color: "rgba(60, 60, 67, 0.6)",
            padding: "4px 8px",
          }}
        >
          Re-enter password
        </button>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Root WalletApp component
// ---------------------------------------------------------------------------

function WalletAppInner() {
  const { state, resetMode } = useWalletContext();
  const prevStateRef = useRef(state);
  const [showConfetti, setShowConfetti] = useState(false);
  const [transitioning, setTransitioning] = useState(false);
  const [displayState, setDisplayState] = useState(state);
  const [showOnboarding, setShowOnboarding] = useState<boolean | null>(null);
  const [showPasswordUpgrade, setShowPasswordUpgrade] = useState(false);

  useEffect(() => {
    void initAnalytics().then(() => flushInstallEvent());
  }, []);

  // Check onboarding flag on mount
  useEffect(() => {
    void onboardingCompleted.getValue().then((done) => {
      setShowOnboarding(!done);
    });
  }, []);

  useEffect(() => {
    const prev = prevStateRef.current;
    prevStateRef.current = state;

    // Cross-fade when unlocking (locked→unlocked or noWallet→unlocked)
    if (state === "unlocked" && (prev === "locked" || prev === "noWallet")) {
      setTransitioning(true);

      // Check if legacy PIN user needs password upgrade
      const upgradeCheck =
        prev === "locked"
          ? credentialVersionStorage.getValue()
          : Promise.resolve(2 as number | null);

      void upgradeCheck.then(async (version) => {
        const needsUpgrade = version === null;
        if (needsUpgrade) setShowPasswordUpgrade(true);
        const alreadyShown = await confettiShown.getValue();
        setTimeout(() => {
          setDisplayState(state);
          setTransitioning(false);
          if (!needsUpgrade && !alreadyShown) {
            setShowConfetti(true);
            void confettiShown.setValue(true);
          }
        }, 250);
      });

      return;
    }

    setDisplayState(state);
  }, [state]);

  if (displayState === "loading" || showOnboarding === null) {
    return (
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          height: "100%",
        }}
      >
        <div
          style={{
            width: "24px",
            height: "24px",
            border: "2px solid rgba(0, 0, 0, 0.1)",
            borderTopColor: "#3C3C43",
            borderRadius: "9999px",
            animation: "sidebar-spin 0.8s linear infinite",
          }}
        />
      </div>
    );
  }

  if (displayState === "noWallet" && showOnboarding) {
    return <OnboardingScreen onComplete={() => setShowOnboarding(false)} />;
  }

  const screen =
    displayState === "noWallet" ? (
      <CreateWalletScreen initialMode={resetMode} />
    ) : displayState === "locked" ? (
      <UnlockScreen />
    ) : showPasswordUpgrade ? (
      <PasswordUpgradeScreen
        onComplete={() => {
          setShowPasswordUpgrade(false);
          void confettiShown.getValue().then((already) => {
            if (!already) {
              setShowConfetti(true);
              void confettiShown.setValue(true);
            }
          });
        }}
      />
    ) : (
      <WalletInterface />
    );

  return (
    <>
      <div
        style={{
          height: "100%",
          opacity: transitioning ? 0 : 1,
          transition: "opacity 0.25s ease",
        }}
      >
        {screen}
      </div>
      {showConfetti && (
        <ConfettiOverlay onComplete={() => setShowConfetti(false)} />
      )}
    </>
  );
}

export default function WalletApp() {
  return (
    <WalletProvider>
      <style>{`
        @keyframes sidebar-spin {
          to { transform: rotate(360deg); }
        }
        /* Firefox: strip native button appearance and hidden inner padding/border */
        button, input, textarea {
          -moz-appearance: none;
          appearance: none;
        }
        button::-moz-focus-inner,
        input::-moz-focus-inner {
          border: 0;
          padding: 0;
        }
      `}</style>
      <div
        style={{
          width: "100%",
          height: "100%",
          background: "#F5F5F5",
          color: "#000",
          fontFamily: "var(--font-geist-sans), sans-serif",
        }}
      >
        <WalletAppInner />
      </div>
    </WalletProvider>
  );
}
