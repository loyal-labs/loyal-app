"use client";

import { Keypair } from "@solana/web3.js";
import { backButton } from "@telegram-apps/sdk";
import { hapticFeedback } from "@telegram-apps/sdk-react";
import bs58 from "bs58";
import {
  CircleAlert,
  CircleArrowDown,
  EyeClosed,
  KeyRound,
  Wallet,
  X,
} from "lucide-react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { useTelegramSafeArea } from "@/hooks/useTelegramSafeArea";
import {
  PUBLIC_KEY_STORAGE_KEY,
  SECRET_KEY_STORAGE_KEY,
} from "@/lib/constants";
import { invalidatePrivateClient } from "@/lib/solana/deposits/private-client";
import {
  getWalletKeypair,
  getWalletPublicKey,
  resetWalletKeypairCache,
} from "@/lib/solana/wallet/wallet-details";
import { setCloudValue } from "@/lib/telegram/mini-app/cloud-storage";

function truncateAddress(address: string): string {
  if (address.length <= 8) return address;
  return `${address.slice(0, 4)}…${address.slice(-4)}`;
}

const SAFETY_STEPS = [
  "Never share this key with anyone.",
  "Do not store this key in screenshots, email, or cloud storage.",
  "If someone gets your private key, they will have full control over your wallet and funds.",
];

// iOS-style sheet timing (matching ReceiveSheet / TokensSheet)
const SHEET_TRANSITION = "transform 0.4s cubic-bezier(0.32, 0.72, 0, 1)";
const OVERLAY_TRANSITION = "opacity 0.3s ease";
const COPIED_RESET_TIMEOUT = 2000;

function PrivateKeySheet({
  walletAddress,
  open,
  onOpenChange,
}: {
  walletAddress: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { bottom: safeBottom } = useTelegramSafeArea();
  const [mounted, setMounted] = useState(false);
  const [headerHeight, setHeaderHeight] = useState(0);
  const [rendered, setRendered] = useState(false);
  const [show, setShow] = useState(false);
  const sheetRef = useRef<HTMLDivElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const dragStartY = useRef(0);
  const dragDelta = useRef(0);
  const isDragging = useRef(false);
  const isClosing = useRef(false);

  const [revealed, setRevealed] = useState(false);
  const [privateKey, setPrivateKey] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  // Load private key when sheet opens
  useEffect(() => {
    if (!open) return;
    getWalletKeypair()
      .then((keypair) => {
        setPrivateKey(bs58.encode(keypair.secretKey));
      })
      .catch((err) => {
        console.error("Failed to load private key", err);
      });
  }, [open]);

  // Open: mount elements, force layout, then trigger CSS transition
  useEffect(() => {
    if (open) {
      isClosing.current = false;
      setRendered(true);
    }
  }, [open]);

  useEffect(() => {
    if (rendered && open && !show && !isClosing.current) {
      sheetRef.current?.getBoundingClientRect();
      setShow(true);
    }
  }, [rendered, open, show]);

  // Measure header
  useEffect(() => {
    if (!open) return;
    const header = document.querySelector("header");
    if (header) {
      setHeaderHeight(header.getBoundingClientRect().bottom);
    }
  }, [open]);

  // Copied reset timer
  useEffect(() => {
    if (!copied) return undefined;
    const timeoutId = window.setTimeout(
      () => setCopied(false),
      COPIED_RESET_TIMEOUT,
    );
    return () => window.clearTimeout(timeoutId);
  }, [copied]);

  const unmount = useCallback(() => {
    setRendered(false);
    setShow(false);
    setRevealed(false);
    setPrivateKey(null);
    onOpenChange(false);
    isClosing.current = false;
  }, [onOpenChange]);

  const closeSheet = useCallback(() => {
    if (isClosing.current) return;
    isClosing.current = true;
    if (hapticFeedback.impactOccurred.isAvailable()) {
      hapticFeedback.impactOccurred("light");
    }
    if (sheetRef.current) {
      sheetRef.current.style.transition = SHEET_TRANSITION;
      sheetRef.current.style.transform = "translateY(100%)";
    }
    if (overlayRef.current) {
      overlayRef.current.style.transition = OVERLAY_TRANSITION;
      overlayRef.current.style.opacity = "0";
    }
  }, []);

  const handleTransitionEnd = useCallback(
    (e: React.TransitionEvent) => {
      if (e.propertyName === "transform" && isClosing.current) {
        unmount();
      }
    },
    [unmount],
  );

  // Pull-down-to-close
  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    isDragging.current = true;
    dragStartY.current = e.touches[0].clientY;
    dragDelta.current = 0;
    if (sheetRef.current) {
      sheetRef.current.style.transition = "none";
    }
  }, []);

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    if (!isDragging.current) return;
    const delta = e.touches[0].clientY - dragStartY.current;
    dragDelta.current = Math.max(0, delta);
    if (sheetRef.current) {
      sheetRef.current.style.transform = `translateY(${dragDelta.current}px)`;
    }
    if (overlayRef.current) {
      const opacity = Math.max(0.2, 1 - dragDelta.current / 300);
      overlayRef.current.style.opacity = String(opacity);
    }
  }, []);

  const handleTouchEnd = useCallback(() => {
    if (!isDragging.current) return;
    isDragging.current = false;
    if (dragDelta.current > 120) {
      closeSheet();
    } else {
      if (sheetRef.current) {
        sheetRef.current.style.transition = SHEET_TRANSITION;
        sheetRef.current.style.transform = "translateY(0px)";
      }
      if (overlayRef.current) {
        overlayRef.current.style.transition = OVERLAY_TRANSITION;
        overlayRef.current.style.opacity = "1";
      }
    }
    dragDelta.current = 0;
  }, [closeSheet]);

  const handleReveal = useCallback(() => {
    if (hapticFeedback.impactOccurred.isAvailable()) {
      hapticFeedback.impactOccurred("medium");
    }
    setRevealed(true);
  }, []);

  const handleCopy = useCallback(async () => {
    if (!privateKey) return;
    if (hapticFeedback.impactOccurred.isAvailable()) {
      hapticFeedback.impactOccurred("medium");
    }
    try {
      if (navigator?.clipboard?.writeText) {
        await navigator.clipboard.writeText(privateKey);
        setCopied(true);
        if (hapticFeedback.notificationOccurred.isAvailable()) {
          hapticFeedback.notificationOccurred("success");
        }
      }
    } catch (err) {
      console.error("Failed to copy key", err);
      if (hapticFeedback.notificationOccurred.isAvailable()) {
        hapticFeedback.notificationOccurred("error");
      }
    }
  }, [privateKey]);

  // Lock body scroll
  useEffect(() => {
    if (rendered) {
      document.body.style.overflow = "hidden";
      return () => {
        document.body.style.overflow = "";
      };
    }
  }, [rendered]);

  if (!mounted || !rendered) return null;

  const sheetTopOffset = headerHeight || 56;

  const content = (
    <>
      {/* Overlay */}
      <div
        ref={overlayRef}
        onClick={closeSheet}
        className="fixed inset-0 z-[9998]"
        style={{
          background: "rgba(0, 0, 0, 0.3)",
          opacity: show ? 1 : 0,
          transition: OVERLAY_TRANSITION,
        }}
      />

      {/* Sheet */}
      <div
        ref={sheetRef}
        onTransitionEnd={handleTransitionEnd}
        className="fixed left-0 right-0 bottom-0 z-[9999] flex flex-col bg-white rounded-t-[38px] font-sans"
        style={{
          top: sheetTopOffset,
          transform: show ? "translateY(0)" : "translateY(100%)",
          transition: SHEET_TRANSITION,
          boxShadow: "0px -4px 40px rgba(0, 0, 0, 0.08)",
        }}
      >
        {/* Handle bar — pull down to close */}
        <div
          className="flex justify-center pt-2 pb-1 shrink-0 cursor-grab active:cursor-grabbing"
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleTouchEnd}
        >
          <div
            className="w-9 h-1 rounded-full"
            style={{ background: "rgba(0, 0, 0, 0.15)" }}
          />
        </div>

        {/* Header — wallet pill + close button, also draggable */}
        <div
          className="relative flex items-center justify-between px-4 pb-2 shrink-0"
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleTouchEnd}
        >
          {/* Invisible spacer for centering */}
          <div className="w-11 h-11 opacity-0" />

          {/* Wallet address pill */}
          <div className="flex items-center bg-[#f2f2f7] rounded-full pl-1.5 pr-4">
            <div className="flex items-center pr-2">
              <div className="w-8 h-8 flex items-center justify-center">
                <Wallet size={20} className="text-black/60" strokeWidth={1.5} />
              </div>
            </div>
            <p className="text-[16px] font-normal leading-5 text-black py-2.5">
              {walletAddress}
            </p>
          </div>

          {/* Close button */}
          <button
            onClick={closeSheet}
            className="w-11 h-11 rounded-full flex items-center justify-center active:scale-95 transition-all duration-150"
            style={{ background: "rgba(0, 0, 0, 0.06)" }}
          >
            <X
              size={20}
              strokeWidth={2}
              style={{ color: "rgba(60, 60, 67, 0.6)" }}
            />
          </button>
        </div>

        {/* Content — scrollable */}
        <div
          className="flex-1 overflow-y-auto overscroll-contain"
          style={{ paddingBottom: Math.max(safeBottom, 24) + 80 }}
        >
          {/* Title */}
          <div className="px-4 pt-4 pb-1">
            <div className="flex flex-col gap-1 py-2 pr-3">
              <h2 className="text-2xl font-semibold leading-7 text-black">
                Private Key
              </h2>
              <p className="text-[17px] font-normal leading-[22px] text-[rgba(60,60,67,0.6)]">
                Your private key gives full control over your wallet and is
                required to restore access. Keep it secret and store it safely.
              </p>
            </div>
          </div>

          {/* Key reveal area */}
          <div className="px-4 py-2">
            {revealed && privateKey ? (
              <div className="bg-[#f2f2f7] rounded-[20px] p-4">
                <p className="text-[15px] font-mono leading-5 text-black break-all">
                  {privateKey}
                </p>
              </div>
            ) : (
              <button
                onClick={handleReveal}
                className="w-full h-[92px] bg-[#f2f2f7] rounded-[20px] relative overflow-hidden flex items-center justify-center gap-3 active:opacity-80 transition-opacity"
              >
                {/* Fake blurred key text behind the reveal button */}
                <div className="absolute inset-x-4 top-3 text-[15px] font-mono leading-5 text-black/40 blur-[6px] select-none pointer-events-none text-left">
                  <p>3xKm9Rz7VdQpN8wLfA2hYbUcTjE5sGnE4vMa</p>
                  <p>Co6XiWtHqFe1uJkBr8yPdZ0mSxRlI7gNvQ2w</p>
                  <p>L4aTn6FcHpVbUeYm3jKs9Rd5Xo</p>
                </div>
                <EyeClosed
                  size={24}
                  className="text-[#f9363c] relative z-10"
                  strokeWidth={1.5}
                />
                <span className="text-[17px] font-normal leading-[22px] text-[#f9363c] relative z-10">
                  Reveal
                </span>
              </button>
            )}
          </div>

          {/* Safety steps */}
          <div className="pb-5">
            {SAFETY_STEPS.map((step, index) => (
              <div
                key={index}
                className="flex items-start overflow-hidden px-4"
              >
                <div className="flex items-start pr-3 py-2 shrink-0">
                  <div className="w-6 h-6 rounded-full bg-[#f9363c] flex items-center justify-center">
                    <span className="text-[14px] font-medium leading-5 text-white text-center">
                      {index + 1}
                    </span>
                  </div>
                </div>
                <div className="flex-1 min-w-0 py-2.5">
                  <p className="text-[15px] font-normal leading-5 text-[rgba(60,60,67,0.6)]">
                    {step}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Bottom button — pinned */}
        <div
          className="shrink-0 px-8 pt-4 bg-gradient-to-b from-transparent to-white"
          style={{ paddingBottom: Math.max(safeBottom, 24) }}
        >
          <button
            onClick={handleCopy}
            disabled={!privateKey}
            className="w-full h-[50px] bg-black rounded-full flex items-center justify-center active:opacity-80 transition-opacity disabled:opacity-40"
          >
            <span className="text-[17px] font-normal leading-[22px] text-white">
              {copied ? "Copied!" : "Copy Key to Clipboard"}
            </span>
          </button>
        </div>
      </div>
    </>
  );

  return createPortal(content, document.body);
}

const SUCCESS_REDIRECT_DELAY_MS = 2000;

function ImportWalletSheet({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const { bottom: safeBottom } = useTelegramSafeArea();
  const [mounted, setMounted] = useState(false);
  const [headerHeight, setHeaderHeight] = useState(0);
  const [rendered, setRendered] = useState(false);
  const [show, setShow] = useState(false);
  const sheetRef = useRef<HTMLDivElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const dragStartY = useRef(0);
  const dragDelta = useRef(0);
  const isDragging = useRef(false);
  const isClosing = useRef(false);

  // "confirm" = initial warning, "input" = key entry, "success" = done
  const [step, setStep] = useState<"confirm" | "input" | "success">("confirm");
  const [importedAddress, setImportedAddress] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [inputKey, setInputKey] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (open) {
      isClosing.current = false;
      setRendered(true);
    }
  }, [open]);

  useEffect(() => {
    if (rendered && open && !show && !isClosing.current) {
      sheetRef.current?.getBoundingClientRect();
      setShow(true);
    }
  }, [rendered, open, show]);

  useEffect(() => {
    if (!open) return;
    const header = document.querySelector("header");
    if (header) {
      setHeaderHeight(header.getBoundingClientRect().bottom);
    }
  }, [open]);

  const unmount = useCallback(() => {
    setRendered(false);
    setShow(false);
    setStep("confirm");
    setInputKey("");
    setError(null);
    setImporting(false);
    onOpenChange(false);
    isClosing.current = false;
  }, [onOpenChange]);

  const closeSheet = useCallback(() => {
    if (isClosing.current) return;
    isClosing.current = true;
    if (hapticFeedback.impactOccurred.isAvailable()) {
      hapticFeedback.impactOccurred("light");
    }
    if (sheetRef.current) {
      sheetRef.current.style.transition = SHEET_TRANSITION;
      sheetRef.current.style.transform = "translateY(100%)";
    }
    if (overlayRef.current) {
      overlayRef.current.style.transition = OVERLAY_TRANSITION;
      overlayRef.current.style.opacity = "0";
    }
  }, []);

  const handleTransitionEnd = useCallback(
    (e: React.TransitionEvent) => {
      if (e.propertyName === "transform" && isClosing.current) {
        unmount();
      }
    },
    [unmount],
  );

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    isDragging.current = true;
    dragStartY.current = e.touches[0].clientY;
    dragDelta.current = 0;
    if (sheetRef.current) {
      sheetRef.current.style.transition = "none";
    }
  }, []);

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    if (!isDragging.current) return;
    const delta = e.touches[0].clientY - dragStartY.current;
    dragDelta.current = Math.max(0, delta);
    if (sheetRef.current) {
      sheetRef.current.style.transform = `translateY(${dragDelta.current}px)`;
    }
    if (overlayRef.current) {
      const opacity = Math.max(0.2, 1 - dragDelta.current / 300);
      overlayRef.current.style.opacity = String(opacity);
    }
  }, []);

  const handleTouchEnd = useCallback(() => {
    if (!isDragging.current) return;
    isDragging.current = false;
    if (dragDelta.current > 120) {
      closeSheet();
    } else {
      if (sheetRef.current) {
        sheetRef.current.style.transition = SHEET_TRANSITION;
        sheetRef.current.style.transform = "translateY(0px)";
      }
      if (overlayRef.current) {
        overlayRef.current.style.transition = OVERLAY_TRANSITION;
        overlayRef.current.style.opacity = "1";
      }
    }
    dragDelta.current = 0;
  }, [closeSheet]);

  const handleConfirmImport = useCallback(() => {
    if (hapticFeedback.impactOccurred.isAvailable()) {
      hapticFeedback.impactOccurred("medium");
    }
    setStep("input");
  }, []);

  const validatePrivateKey = useCallback(
    (key: string): { valid: true; keypair: Keypair } | { valid: false; error: string } => {
      if (!key) {
        return { valid: false, error: "Please enter a private key." };
      }

      if (key.length < 32) {
        return { valid: false, error: "Key is too short. A valid Solana private key is 64 bytes encoded in base58." };
      }

      if (key.length > 128) {
        return { valid: false, error: "Key is too long. A valid Solana private key is 64 bytes encoded in base58." };
      }

      // Check base58 charset
      const base58Regex = /^[123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz]+$/;
      if (!base58Regex.test(key)) {
        return { valid: false, error: "Invalid characters. Private keys use base58 encoding (no 0, O, I, or l)." };
      }

      let decoded: Uint8Array;
      try {
        decoded = bs58.decode(key);
      } catch {
        return { valid: false, error: "Invalid base58 encoding. Check for typos and try again." };
      }

      if (decoded.length !== 64) {
        return {
          valid: false,
          error: `Invalid key length (${decoded.length} bytes). A Solana private key must be exactly 64 bytes.`,
        };
      }

      try {
        const keypair = Keypair.fromSecretKey(decoded);
        return { valid: true, keypair };
      } catch {
        return { valid: false, error: "Invalid private key. Could not derive a valid wallet from this key." };
      }
    },
    [],
  );

  const handleImport = useCallback(async () => {
    const trimmed = inputKey.trim();
    const result = validatePrivateKey(trimmed);

    if (!result.valid) {
      setError(result.error);
      if (hapticFeedback.notificationOccurred.isAvailable()) {
        hapticFeedback.notificationOccurred("error");
      }
      return;
    }

    setError(null);
    setImporting(true);

    try {
      const publicKey = result.keypair.publicKey.toBase58();
      const secretKey = JSON.stringify(Array.from(result.keypair.secretKey));

      const storedPublic = await setCloudValue(
        PUBLIC_KEY_STORAGE_KEY,
        publicKey,
      );
      if (!storedPublic) throw new Error("Failed to save public key");

      const storedSecret = await setCloudValue(
        SECRET_KEY_STORAGE_KEY,
        secretKey,
      );
      if (!storedSecret) throw new Error("Failed to save secret key");

      resetWalletKeypairCache();
      await invalidatePrivateClient();

      if (hapticFeedback.notificationOccurred.isAvailable()) {
        hapticFeedback.notificationOccurred("success");
      }

      setImportedAddress(publicKey);
      setStep("success");
      setImporting(false);

      // Redirect to wallet page after a brief success display
      setTimeout(() => {
        router.push("/telegram/wallet");
      }, SUCCESS_REDIRECT_DELAY_MS);
    } catch {
      setImporting(false);
      if (hapticFeedback.notificationOccurred.isAvailable()) {
        hapticFeedback.notificationOccurred("error");
      }
      setError("Failed to import wallet. Please try again.");
    }
  }, [inputKey, validatePrivateKey, router]);

  useEffect(() => {
    if (rendered) {
      document.body.style.overflow = "hidden";
      return () => {
        document.body.style.overflow = "";
      };
    }
  }, [rendered]);

  if (!mounted || !rendered) return null;

  const sheetTopOffset = headerHeight || 56;

  const content = (
    <>
      <div
        ref={overlayRef}
        onClick={closeSheet}
        className="fixed inset-0 z-[9998]"
        style={{
          background: "rgba(0, 0, 0, 0.3)",
          opacity: show ? 1 : 0,
          transition: OVERLAY_TRANSITION,
        }}
      />

      <div
        ref={sheetRef}
        onTransitionEnd={handleTransitionEnd}
        className="fixed left-0 right-0 bottom-0 z-[9999] flex flex-col bg-white rounded-t-[38px] font-sans"
        style={{
          top: sheetTopOffset,
          transform: show ? "translateY(0)" : "translateY(100%)",
          transition: SHEET_TRANSITION,
          boxShadow: "0px -4px 40px rgba(0, 0, 0, 0.08)",
        }}
      >
        {/* Handle bar */}
        <div
          className="flex justify-center pt-2 pb-1 shrink-0 cursor-grab active:cursor-grabbing"
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleTouchEnd}
        >
          <div
            className="w-9 h-1 rounded-full"
            style={{ background: "rgba(0, 0, 0, 0.15)" }}
          />
        </div>

        {/* Toolbar — title (input step only) + close button */}
        <div
          className="relative flex items-center justify-between px-4 pb-1 shrink-0"
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleTouchEnd}
        >
          {/* Invisible spacer for centering */}
          <div className="w-11 h-11 opacity-0" />

          {/* Centered title — visible on input and success steps */}
          {(step === "input" || step === "success") && (
            <span className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 text-[17px] font-semibold text-black leading-[22px] whitespace-nowrap">
              Import Wallet
            </span>
          )}

          <button
            onClick={closeSheet}
            className="w-11 h-11 rounded-full flex items-center justify-center active:scale-95 transition-all duration-150 bg-[#f2f2f7]"
          >
            <X
              size={20}
              strokeWidth={2}
              style={{ color: "rgba(60, 60, 67, 0.6)" }}
            />
          </button>
        </div>

        {step === "confirm" && (
          <>
            {/* Confirmation content */}
            <div className="flex-1 overflow-y-auto overscroll-contain">
              {/* Icon + Title + Description */}
              <div className="flex flex-col items-center gap-5 px-8 pt-4 pb-2">
                {/* Large alert icon */}
                <div className="w-24 h-24 flex items-center justify-center">
                  <CircleAlert
                    size={96}
                    className="text-[#f9363c]"
                    strokeWidth={1}
                  />
                </div>

                <div className="flex flex-col gap-1 items-center text-center w-full">
                  <h2 className="text-2xl font-semibold leading-7 text-black">
                    Important Notice
                  </h2>
                  <p className="text-[17px] font-normal leading-[22px] text-[rgba(60,60,67,0.6)]">
                    Importing a new private key will permanently replace your
                    current wallet on this device.
                  </p>
                </div>
              </div>

              {/* Warning box */}
              <div className="px-4 pb-5">
                <div
                  className="flex items-center rounded-[20px] px-4 py-1"
                  style={{ background: "rgba(249, 54, 60, 0.14)" }}
                >
                  <div className="flex items-center pr-3 py-2.5 shrink-0">
                    <CircleAlert
                      size={24}
                      className="text-[#f9363c]"
                      strokeWidth={1.5}
                    />
                  </div>
                  <div className="flex-1 py-[9px]">
                    <p className="text-[15px] font-normal leading-5 text-black/60">
                      Make sure you have securely saved the private key of your
                      current wallet before continuing. Without it, you may lose
                      access permanently.
                    </p>
                  </div>
                </div>
              </div>
            </div>

            {/* Bottom buttons */}
            <div
              className="shrink-0 px-8 pt-4 flex flex-col gap-2.5"
              style={{ paddingBottom: Math.max(safeBottom, 24) }}
            >
              <button
                onClick={handleConfirmImport}
                className="w-full h-[50px] bg-black rounded-full flex items-center justify-center active:opacity-80 transition-opacity"
              >
                <span className="text-[17px] font-normal leading-[22px] text-white">
                  Import Wallet
                </span>
              </button>
              <button
                onClick={closeSheet}
                className="w-full h-[50px] bg-[#f2f2f7] rounded-full flex items-center justify-center active:opacity-80 transition-opacity"
              >
                <span className="text-[17px] font-normal leading-[22px] text-black">
                  Back
                </span>
              </button>
            </div>
          </>
        )}

        {step === "input" && (
          <>
            {/* Key input step */}
            <div className="flex-1 overflow-y-auto overscroll-contain">
              {/* Section heading */}
              <div className="px-4 pt-4 pb-1">
                <div className="py-2 pr-3">
                  <h2 className="text-2xl font-semibold leading-7 text-black">
                    Private Key
                  </h2>
                </div>
              </div>

              {/* Input card + paste button */}
              <div className="flex flex-col items-center gap-2.5 px-4 py-4">
                <div className="w-full">
                  <textarea
                    ref={textareaRef}
                    value={inputKey}
                    onChange={(e) => {
                      setInputKey(e.target.value);
                      setError(null);
                    }}
                    placeholder="Paste or start typing"
                    className="w-full min-h-[120px] bg-[#f2f2f7] rounded-[20px] px-4 py-[13px] text-[17px] font-normal leading-[22px] text-black placeholder:text-[rgba(60,60,67,0.6)] resize-none outline-none"
                    style={{
                      border: error
                        ? "1px solid #f9363c"
                        : "1px solid transparent",
                    }}
                  />
                  {error && (
                    <div className="px-4 pt-2 pb-1.5">
                      <p className="text-[13px] font-normal leading-4 text-[#f9363c]">
                        {error}
                      </p>
                    </div>
                  )}
                </div>

                <p className="text-[13px] font-normal leading-4 text-[rgba(60,60,67,0.6)] text-center px-4">
                  Long-press the text field and select Paste.
                </p>
              </div>
            </div>

            {/* Bottom button */}
            <div
              className="shrink-0 px-8 pt-4 bg-gradient-to-b from-transparent to-white"
              style={{ paddingBottom: Math.max(safeBottom, 24) }}
            >
              <button
                onClick={handleImport}
                disabled={!inputKey.trim() || importing}
                className="w-full h-[50px] rounded-full flex items-center justify-center active:opacity-80 transition-opacity"
                style={{
                  background:
                    !inputKey.trim() || importing ? "#d0d0d2" : "#000",
                }}
              >
                <span className="text-[17px] font-normal leading-[22px] text-white">
                  {importing ? "Importing…" : "Import"}
                </span>
              </button>
            </div>
          </>
        )}

        {step === "success" && (
          <div className="flex-1 flex flex-col items-center justify-center px-6 pb-24">
            <div className="relative mb-5">
              <Image
                src="/dogs/dog-green.png"
                alt="Success"
                width={96}
                height={96}
              />
            </div>
            <div className="flex flex-col gap-2 items-center text-center max-w-[280px]">
              <h2 className="text-xl font-semibold text-black leading-6">
                Wallet Imported
              </h2>
              <p
                className="text-base leading-5"
                style={{ color: "rgba(60, 60, 67, 0.6)" }}
              >
                Your new wallet{" "}
                <span className="text-black">
                  {importedAddress
                    ? truncateAddress(importedAddress)
                    : ""}
                </span>{" "}
                is now active.
              </p>
            </div>
          </div>
        )}
      </div>
    </>
  );

  return createPortal(content, document.body);
}

export default function KeysRecoveryPage() {
  const router = useRouter();
  const [walletAddress, setWalletAddress] = useState<string | null>(null);
  const [fullAddress, setFullAddress] = useState<string>("");
  const [sheetOpen, setSheetOpen] = useState(false);
  const [importSheetOpen, setImportSheetOpen] = useState(false);

  // Load wallet address on mount
  useEffect(() => {
    getWalletPublicKey()
      .then((pubkey) => {
        const addr = pubkey.toBase58();
        setFullAddress(addr);
        setWalletAddress(truncateAddress(addr));
      })
      .catch((err) => {
        console.error("Failed to load wallet address", err);
        setWalletAddress("Unavailable");
      });
  }, []);

  // Back button
  useEffect(() => {
    try {
      backButton.mount();
    } catch {
      // Mount may not be available in all contexts
    }
    if (backButton.show.isAvailable()) {
      backButton.show();
    }

    const handleBack = () => {
      if (hapticFeedback.impactOccurred.isAvailable()) {
        hapticFeedback.impactOccurred("light");
      }
      router.push("/telegram/profile");
    };

    if (backButton.onClick.isAvailable()) {
      backButton.onClick(handleBack);
    }

    return () => {
      if (backButton.hide.isAvailable()) {
        backButton.hide();
      }
      if (backButton.offClick.isAvailable()) {
        backButton.offClick(handleBack);
      }
      try {
        backButton.unmount();
      } catch {
        // Unmount may not be available in all contexts
      }
    };
  }, [router]);

  const handleOpenSheet = useCallback(() => {
    if (hapticFeedback.impactOccurred.isAvailable()) {
      hapticFeedback.impactOccurred("light");
    }
    setSheetOpen(true);
  }, []);

  return (
    <main className="min-h-screen bg-white font-sans overflow-hidden relative">
      <div className="pb-32 max-w-md mx-auto flex flex-col min-h-screen">
        {/* Title */}
        <div className="px-4 pt-4 pb-1">
          <div className="flex flex-col gap-1 py-2 pr-3">
            <h1 className="text-2xl font-semibold leading-7 text-black">
              Keys & Recovery
            </h1>
            <p className="text-[17px] font-normal leading-[22px] text-[rgba(60,60,67,0.6)]">
              Manage the keys that control your wallet.
            </p>
          </div>
        </div>

        {/* Export Wallet */}
        <div className="px-4">
          <div className="px-3 pt-3 pb-2">
            <p className="text-[16px] font-medium leading-5 tracking-[-0.176px] text-[rgba(60,60,67,0.6)]">
              Export Wallet
            </p>
          </div>
          <div className="flex gap-2">
            <button
              onClick={handleOpenSheet}
              className="flex-1 bg-[#f2f2f7] rounded-[20px] p-4 flex flex-col gap-3 items-start active:opacity-80 transition-opacity text-left"
            >
              <div className="w-9 h-9 rounded-full bg-[#f9363c] flex items-center justify-center">
                <KeyRound size={20} className="text-white" strokeWidth={2} />
              </div>
              <div className="flex flex-col w-full">
                <p className="text-[17px] font-medium leading-[22px] tracking-[-0.187px] text-black">
                  Private Key
                </p>
                <p className="text-[15px] font-normal leading-5 text-[rgba(60,60,67,0.6)]">
                  {walletAddress ?? "Loading…"}
                </p>
              </div>
            </button>
            {/* Invisible plug to keep card half-width */}
            <div className="flex-1" />
          </div>
        </div>

        {/* Import Wallet */}
        <div className="px-4 mt-4">
          <div className="px-3 pt-3 pb-2">
            <p className="text-[16px] font-medium leading-5 tracking-[-0.176px] text-[rgba(60,60,67,0.6)]">
              Import Wallet
            </p>
          </div>
          <button
            onClick={() => {
              if (hapticFeedback.impactOccurred.isAvailable()) {
                hapticFeedback.impactOccurred("light");
              }
              setImportSheetOpen(true);
            }}
            className="w-full border-2 border-dashed border-[#f2f2f7] rounded-[20px] py-1 text-left active:opacity-80 transition-opacity"
          >
            <div className="flex items-center w-full overflow-hidden px-4">
              <div className="flex items-center pr-3 py-1.5">
                <div className="flex items-center justify-center pr-1 py-2.5">
                  <div className="text-black/60">
                    <CircleArrowDown size={28} strokeWidth={1.5} />
                  </div>
                </div>
              </div>
              <div className="flex-1 flex flex-col min-w-0 py-[9px]">
                <p className="text-[17px] font-medium leading-[22px] text-black">
                  Import
                </p>
                <p className="text-[15px] font-normal leading-5 text-[rgba(60,60,67,0.6)]">
                  Add an existing wallet using a private key. Your current
                  wallet will be replaced.
                </p>
              </div>
            </div>
          </button>
        </div>
      </div>

      {/* Private Key Sheet */}
      <PrivateKeySheet
        walletAddress={truncateAddress(fullAddress)}
        open={sheetOpen}
        onOpenChange={setSheetOpen}
      />

      {/* Import Wallet Sheet */}
      <ImportWalletSheet
        open={importSheetOpen}
        onOpenChange={setImportSheetOpen}
      />
    </main>
  );
}
