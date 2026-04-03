import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import lottie from "lottie-web/build/player/lottie_light";
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
import { Keypair } from "@solana/web3.js";
import { generateKeypair } from "~/src/lib/keypair-storage";
import { useWalletContext, WalletProvider } from "./wallet-provider";
import { PinInput } from "./shared";

import { PortfolioContent } from "./portfolio-content";
import type { TokenRowActions } from "./token-row-item";
import { SendContent } from "./send-content";
import { ReceiveContent } from "./receive-content";
import { SwapContent } from "./swap-content";
import { ShieldContent, SwapShieldTabs } from "./shield-content";

import { AllTokensView } from "./all-tokens-view";
import { AllActivityView } from "./all-activity-view";
import { TokenSelectView } from "./token-select-view";
import { TransactionDetailView } from "./transaction-detail-view";
import { Settings } from "./settings";
import { DappApprovalView } from "./dapp-approval-view";
import { useWalletData } from "@loyal-labs/wallet-core/hooks";
import { getTokenIconUrl } from "@loyal-labs/wallet-core/lib";
import { useExtensionWalletDataClient } from "~/src/lib/wallet-data-client";
import {
  pendingDappApproval,
  connectedDappOrigins,
  onboardingCompleted,
} from "~/src/lib/storage";
import type { DappConnectResponse } from "~/src/lib/dapp-messages";
import { OnboardingScreen } from "./onboarding-screen";
import {
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

function Logotype() {
  return (
    <svg
      width="49"
      height="20"
      viewBox="0 0 49 20"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        d="M41.8672 0H44.8439V13.3023C44.8439 13.8837 45.1695 14.2093 45.7509 14.2093H46.6811V16.5116H44.9835C43.123 16.5116 41.8672 15.3488 41.8672 13.4186V0Z"
        fill="black"
      />
      <path
        d="M28.7366 7.95325C29.225 5.37185 31.2018 3.90674 34.2483 3.90674C37.8064 3.90674 39.6669 5.74395 39.6669 9.20906V13.4416C39.6669 14.1393 39.9692 14.3486 40.4343 14.3486H40.9227V16.5114L40.225 16.5346C39.2715 16.5579 37.318 16.5812 37.0855 14.6277C36.5041 15.8602 35.1087 16.7905 32.9692 16.7905C30.4808 16.7905 28.5273 15.4649 28.5273 13.2788C28.5273 10.9067 30.318 10.0928 33.225 9.53464L36.6669 8.86023C36.6669 6.95325 35.8529 6.04627 34.2483 6.04627C32.9227 6.04627 32.0622 6.7672 31.7832 8.11604L28.7366 7.95325ZM31.6204 13.1858C31.6204 14.023 32.3413 14.6974 33.7832 14.6974C35.4576 14.6974 36.7366 13.4649 36.7366 11.0463V10.8835L34.3878 11.3021C32.8297 11.5812 31.6204 11.7905 31.6204 13.1858Z"
        fill="black"
      />
      <path
        d="M16.6719 4.18604H19.5556L22.8579 13.3953L26.044 4.18604H28.9277L24.0207 17.8139C23.4858 19.3256 22.4858 20 20.8347 20H18.8114V17.7209H20.323C21.044 17.7209 21.3928 17.4884 21.6486 16.907L21.9975 16H21.137L16.6719 4.18604Z"
        fill="black"
      />
      <path
        d="M11.1553 16.7905C7.45767 16.7905 5.03906 14.2556 5.03906 10.3486C5.03906 6.44162 7.45767 3.90674 11.1553 3.90674C14.8298 3.90674 17.2484 6.44162 17.2484 10.3486C17.2484 14.2556 14.8298 16.7905 11.1553 16.7905ZM8.13208 10.3486C8.13208 12.8835 9.22511 14.3719 11.1553 14.3719C13.0623 14.3719 14.1786 12.8835 14.1786 10.3486C14.1786 7.81371 13.0623 6.32534 11.1553 6.32534C9.22511 6.32534 8.13208 7.81371 8.13208 10.3486Z"
        fill="black"
      />
      <path
        d="M0 0H2.97674V13.3023C2.97674 13.8837 3.30232 14.2093 3.88372 14.2093H4.81395V16.5116H3.11628C1.25581 16.5116 0 15.3488 0 13.4186V0Z"
        fill="black"
      />
    </svg>
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
  const [pin, setPin] = useState("");
  const [confirmPin, setConfirmPin] = useState("");
  const [step, setStep] = useState<"enter" | "confirm">("enter");
  const [secretKeyInput, setSecretKeyInput] = useState("");
  const [showImportKey, setShowImportKey] = useState(false);
  const [mode, setMode] = useState<"create" | "import">(initialMode);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [pendingKeypair, setPendingKeypair] = useState<Keypair | null>(null);
  const [copied, setCopied] = useState(false);

  const secretKeyHex = pendingKeypair
    ? Array.from(pendingKeypair.secretKey)
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("")
    : "";

  const handleGenerateKeypair = useCallback(async (finalPin: string) => {
    setLoading(true);
    try {
      const keypair = await generateKeypair(finalPin);
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

  const handlePinComplete = useCallback(
    (enteredPin: string) => {
      if (step === "enter") {
        setPin(enteredPin);
        setStep("confirm");
        setConfirmPin("");
        setError(null);
      } else {
        if (enteredPin !== pin) {
          setError("PINs don't match");
          setConfirmPin("");
          return;
        }
        setConfirmPin(enteredPin);
        setError(null);
        if (mode === "import") return;
        void handleGenerateKeypair(enteredPin);
      }
    },
    [step, pin, mode, handleGenerateKeypair]
  );

  const handleImport = async () => {
    try {
      const hex = secretKeyInput.trim().replace(/^0x/, "");
      if (!hex) throw new Error("Private key cannot be empty");
      const pairs = hex.match(/.{1,2}/g);
      if (!pairs) throw new Error("Invalid hex format");
      const bytes = new Uint8Array(pairs.map((b) => parseInt(b, 16)));
      setError(null);
      setLoading(true);
      await importWallet(bytes, pin);
      const importedKeypair = Keypair.fromSecretKey(bytes);
      identifyWallet(importedKeypair.publicKey.toBase58(), "imported");
      track(WALLET_SETUP_EVENTS.walletImported);
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Invalid secret key or import failed"
      );
    } finally {
      setLoading(false);
    }
  };

  const handleBack = useCallback(() => {
    setStep("enter");
    setConfirmPin("");
    setPin("");
    setError(null);
  }, []);

  const pinLabel =
    step === "enter" ? "Create a numerical PIN" : "Confirm your PIN";
  const showImportField =
    mode === "import" &&
    step === "confirm" &&
    confirmPin.length === 4 &&
    confirmPin === pin;

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
        {/* Branding cluster — shield + logotype tight together */}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: "4px",
            marginBottom: "32px",
          }}
        >
          <ShieldAnimation size={80} />
          <Logotype />
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
              setPin("");
              setConfirmPin("");
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
              setPin("");
              setConfirmPin("");
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

        {/* PIN input — don't pass disabled during create loading to prevent layout shift */}
        <PinInput
          value={step === "enter" ? pin : confirmPin}
          onChange={step === "enter" ? setPin : setConfirmPin}
          onComplete={handlePinComplete}
          error={!!error}
          label={pinLabel}
        />

        {/* Back button — always rendered to reserve space and prevent layout shift */}
        <button
          type="button"
          onClick={handleBack}
          style={{
            marginTop: "12px",
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
          Re-enter PIN
        </button>

        {/* Import key field + button — animated reveal after PIN is confirmed */}
        <div
          style={{
            width: "100%",
            overflow: "hidden",
            maxHeight: showImportField ? "300px" : "0px",
            opacity: showImportField ? 1 : 0,
            transition:
              "max-height 0.35s cubic-bezier(0.4, 0, 0.2, 1), opacity 0.3s ease",
          }}
        >
          <div style={{ width: "100%", marginTop: "16px" }}>
            <div style={{ position: "relative", width: "100%" }}>
              <textarea
                placeholder="Private key (hex)"
                value={secretKeyInput}
                onChange={(e) => setSecretKeyInput(e.target.value)}
                rows={4}
                style={{
                  width: "100%",
                  background: "#fff",
                  border: "none",
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

        {error && (
          <p
            style={{
              fontFamily: "var(--font-geist-sans), sans-serif",
              fontSize: "13px",
              lineHeight: "16px",
              color: "#FF3B30",
              textAlign: "center",
              marginTop: "8px",
            }}
          >
            {error}
          </p>
        )}
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

function UnlockScreen() {
  const { unlock, publicKey, resetWallet } = useWalletContext();
  const [pin, setPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [resetAction, setResetAction] = useState<"create" | "import" | null>(
    null
  );

  const handleUnlock = useCallback(
    async (enteredPin: string) => {
      setError(null);
      setLoading(true);
      try {
        await unlock(enteredPin);
        track(WALLET_SETUP_EVENTS.walletUnlocked);
      } catch {
        setError("Wrong PIN");
        setPin("");
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
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        height: "100%",
        padding: "0 20px",
      }}
    >
      {/* Branding cluster */}
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: "4px",
          marginBottom: "32px",
        }}
      >
        <ShieldAnimation size={80} />
        <Logotype />
        {truncatedKey && (
          <span
            style={{
              fontFamily: "monospace",
              fontSize: "13px",
              lineHeight: "16px",
              color: "rgba(60, 60, 67, 0.6)",
              marginTop: "4px",
            }}
          >
            {truncatedKey}
          </span>
        )}
      </div>

      {/* PIN input */}
      <PinInput
        value={pin}
        onChange={setPin}
        onComplete={handleUnlock}
        error={!!error}
        disabled={loading}
        label="Enter your PIN"
      />

      {error && (
        <p
          style={{
            fontFamily: "var(--font-geist-sans), sans-serif",
            fontSize: "13px",
            lineHeight: "16px",
            color: "#FF3B30",
            textAlign: "center",
            marginTop: "12px",
          }}
        >
          {error}
        </p>
      )}

      {loading && (
        <p
          style={{
            fontFamily: "var(--font-geist-sans), sans-serif",
            fontSize: "14px",
            lineHeight: "20px",
            color: "rgba(60, 60, 67, 0.6)",
            textAlign: "center",
            marginTop: "12px",
          }}
        >
          Unlocking...
        </p>
      )}

      {/* Reset wallet options */}
      <div
        style={{
          display: "flex",
          gap: "8px",
          width: "100%",
          marginTop: "24px",
        }}
      >
        <button
          type="button"
          onClick={() => setResetAction("create")}
          style={{
            flex: 1,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: "10px 0",
            borderRadius: "10px",
            border: "none",
            cursor: "pointer",
            background: "rgba(255, 59, 48, 0.08)",
            fontFamily: "var(--font-geist-sans), sans-serif",
            fontSize: "13px",
            fontWeight: 500,
            lineHeight: "16px",
            color: "#FF3B30",
            transition: "background 0.15s ease",
          }}
        >
          Create New Wallet
        </button>
        <button
          type="button"
          onClick={() => setResetAction("import")}
          style={{
            flex: 1,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: "10px 0",
            borderRadius: "10px",
            border: "none",
            cursor: "pointer",
            background: "rgba(255, 59, 48, 0.08)",
            fontFamily: "var(--font-geist-sans), sans-serif",
            fontSize: "13px",
            fontWeight: 500,
            lineHeight: "16px",
            color: "#FF3B30",
            transition: "background 0.15s ease",
          }}
        >
          Import Wallet
        </button>
      </div>

      {/* Confirmation card */}
      <div
        style={{
          width: "100%",
          maxHeight: resetAction ? "200px" : "0",
          opacity: resetAction ? 1 : 0,
          overflow: "hidden",
          transition:
            "max-height 0.3s cubic-bezier(0.4, 0, 0.2, 1), opacity 0.25s cubic-bezier(0.4, 0, 0.2, 1), margin 0.3s cubic-bezier(0.4, 0, 0.2, 1)",
          marginTop: resetAction ? "12px" : "0",
        }}
      >
        <div
          style={{
            background: "#fff",
            borderRadius: "16px",
            border: "1px solid rgba(255, 59, 48, 0.2)",
            padding: "16px",
            display: "flex",
            flexDirection: "column",
            gap: "12px",
          }}
        >
          <span
            style={{
              fontFamily: "var(--font-geist-sans), sans-serif",
              fontSize: "13px",
              fontWeight: 500,
              lineHeight: "18px",
              color: "#FF3B30",
              textAlign: "center",
            }}
          >
            Your current wallet will be erased. Without an exported key you will
            lose access forever.
          </span>
          <div style={{ display: "flex", gap: "8px" }}>
            <button
              type="button"
              onClick={() => {
                const action = resetAction;
                setResetAction(null);
                track(WALLET_SETUP_EVENTS.walletReset, {
                  new_mode: action === "import" ? "import" : "create",
                });
                resetAnalytics();
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
                fontFamily: "var(--font-geist-sans), sans-serif",
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
                fontFamily: "var(--font-geist-sans), sans-serif",
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

  // Watch for pending dApp approval requests from storage
  useEffect(() => {
    // Check current value on mount
    void pendingDappApproval.getValue().then((req) => {
      if (req) {
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
          });
        }
      }
    });

    // Watch for changes
    const unwatch = pendingDappApproval.watch((req) => {
      if (req) {
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
          });
        }
      }
    });

    return unwatch;
  }, []);

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

  const shieldSecuredBalance = useMemo(() => {
    if (!shieldToken.mint) return 0;
    const position = positions.find((p) => p.asset.mint === shieldToken.mint);
    return position?.securedBalance ?? 0;
  }, [shieldToken.mint, positions]);

  // Convert allTokenRows to SwapToken[] for token-select views
  const swapTokens: SwapToken[] = positions.map((p) => ({
    mint: p.asset.mint,
    symbol: p.asset.symbol,
    icon: p.asset.imageUrl || getTokenIconUrl(p.asset.symbol),
    price: p.priceUsd ?? 0,
    balance: p.totalBalance,
  }));

  // Sync token state when real positions load
  useEffect(() => {
    if (swapTokens.length > 0 && swapTokens[0].mint) {
      setFromToken(swapTokens[0]);
      setSendToken(swapTokens[0]);
      setShieldToken(swapTokens[0]);
      setToToken(
        swapTokens.find((t) => t.mint === LOYL_TOKEN.mint) ?? LOYL_TOKEN
      );
    }
  }, [positions.length]);

  const getTokenActions = useCallback(
    (token: TokenRow): TokenRowActions | undefined => {
      const isLoyal = token.id === LOYL_TOKEN.mint || token.symbol === "LOYAL";
      const isSecured = token.isSecured === true;

      if (isSecured) {
        return {
          onSend: () => handleTabChange("send"),
          onUnshield: () => { setSwapMode("shield"); handleTabChange("shield"); },
        };
      }

      const actions: TokenRowActions = {
        onSend: () => handleTabChange("send"),
        onSwap: () => { setSwapMode("swap"); handleTabChange("swap"); },
        onShield: () => { setSwapMode("shield"); handleTabChange("shield"); },
      };

      if (isLoyal) {
        actions.onBuy = () => {
          globalThis.open(`https://jup.ag/tokens/${LOYL_TOKEN.mint}`, "_blank");
        };
      }

      return actions;
    },
    [handleTabChange, setSwapMode],
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
            tokenRows={tokenRows}
            transactionDetails={transactionDetails}
            walletAddress={walletAddress}
            walletLabel={walletLabel}
            getTokenActions={getTokenActions}
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
            onTokenChange={setShieldToken}
            onClose={handleClose}
            onNavigate={handleNavigate}
            onDone={handleDone}
            securedBalance={shieldSecuredBalance}
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
            tokens={allTokenRows}
            isBalanceHidden={balanceHidden}
            onBack={goBack}
            onClose={handleClose}
            getTokenActions={getTokenActions}
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
          tokens={swapTokens}
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
          title="Shield token"
          currentToken={shieldToken}
          onSelect={(token) => {
            setShieldToken(token);
            setSubView(null);
          }}
          onBack={goBack}
          onClose={handleClose}
          tokens={swapTokens}
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
            void browser.runtime.sendMessage({
              type: "DAPP_APPROVAL_DECISION",
              id: subView.requestId,
              approved: false,
            });
            setSubView(null);
          }}
          onApprove={() => {
            // Send connect response with public key
            void browser.runtime.sendMessage({
              type: "DAPP_CONNECT_RESPONSE",
              id: subView.requestId,
              approved: true,
              publicKey: publicKey,
            } satisfies DappConnectResponse);
            // Save origin as connected
            void connectedDappOrigins.getValue().then((origins) => {
              if (!origins.includes(subView.origin)) {
                void connectedDappOrigins.setValue([
                  ...origins,
                  subView.origin,
                ]);
              }
            });
            setSubView(null);
          }}
          onClose={() => {
            void browser.runtime.sendMessage({
              type: "DAPP_APPROVAL_DECISION",
              id: subView.requestId,
              approved: false,
            });
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
          onDeny={() => {
            void browser.runtime.sendMessage({
              type: "DAPP_APPROVAL_DECISION",
              id: subView.requestId,
              approved: false,
            });
            setSubView(null);
          }}
          onApprove={() => {
            void browser.runtime.sendMessage({
              type: "DAPP_APPROVAL_DECISION",
              id: subView.requestId,
              approved: true,
            });
            setSubView(null);
          }}
          onClose={() => {
            void browser.runtime.sendMessage({
              type: "DAPP_APPROVAL_DECISION",
              id: subView.requestId,
              approved: false,
            });
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
// Root WalletApp component
// ---------------------------------------------------------------------------

function WalletAppInner() {
  const { state, resetMode } = useWalletContext();
  const prevStateRef = useRef(state);
  const [showConfetti, setShowConfetti] = useState(false);
  const [transitioning, setTransitioning] = useState(false);
  const [displayState, setDisplayState] = useState(state);
  const [showOnboarding, setShowOnboarding] = useState<boolean | null>(null);

  useEffect(() => {
    void initAnalytics();
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
      // Fade out the old screen, then swap content + fade in + confetti
      const t = setTimeout(() => {
        setDisplayState(state);
        setTransitioning(false);
        setShowConfetti(true);
      }, 250);
      return () => clearTimeout(t);
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
