"use client";

import { hapticFeedback, shareURL } from "@telegram-apps/sdk-react";
import { X } from "lucide-react";
import Image from "next/image";
import QRCodeLib from "qrcode";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";

import { useTelegramSafeArea } from "@/hooks/useTelegramSafeArea";
import { getSolscanAccountUrl } from "@/lib/solana/rpc/explorer";
import { getWalletPublicKey } from "@/lib/solana/wallet/wallet-details";
import { hideAllButtons } from "@/lib/telegram/mini-app/buttons";

// iOS-style sheet timing (shared with TokensSheet)
const SHEET_TRANSITION = "transform 0.4s cubic-bezier(0.32, 0.72, 0, 1)";
const OVERLAY_TRANSITION = "opacity 0.3s ease";

// Custom QR Code with rounded finder patterns (black on white, for light theme)
interface StyledQRCodeProps {
  value: string;
  size: number;
  logoSrc: string;
  logoSize: number;
}

function StyledQRCode({ value, size, logoSrc, logoSize }: StyledQRCodeProps) {
  const [modules, setModules] = useState<boolean[][]>([]);

  useEffect(() => {
    const generateQR = async () => {
      try {
        const qr = QRCodeLib.create(value, { errorCorrectionLevel: "M" });
        const data = qr.modules.data;
        const moduleCount = qr.modules.size;

        const matrix: boolean[][] = [];
        for (let row = 0; row < moduleCount; row++) {
          const rowData: boolean[] = [];
          for (let col = 0; col < moduleCount; col++) {
            rowData.push(data[row * moduleCount + col] === 1);
          }
          matrix.push(rowData);
        }
        setModules(matrix);
      } catch (error) {
        console.error("Failed to generate QR code", error);
      }
    };
    void generateQR();
  }, [value]);

  if (modules.length === 0) return null;

  const moduleCount = modules.length;
  const cellSize = size / moduleCount;
  const finderSize = 7;
  const cornerRadius = cellSize * 1.5;

  const isFinderPattern = (row: number, col: number) => {
    if (row < finderSize && col < finderSize) return true;
    if (row < finderSize && col >= moduleCount - finderSize) return true;
    if (row >= moduleCount - finderSize && col < finderSize) return true;
    return false;
  };

  const centerStart = Math.floor((moduleCount - logoSize / cellSize) / 2);
  const centerEnd = Math.ceil((moduleCount + logoSize / cellSize) / 2);
  const isCenterArea = (row: number, col: number) => {
    return row >= centerStart && row < centerEnd && col >= centerStart && col < centerEnd;
  };

  const renderFinderPattern = (startRow: number, startCol: number, id: string) => {
    const x = startCol * cellSize;
    const y = startRow * cellSize;
    const outerSize = finderSize * cellSize;
    const middleOffset = cellSize;
    const middleSize = 5 * cellSize;
    const innerOffset = 2 * cellSize;
    const innerSize = 3 * cellSize;
    const middleRadius = cornerRadius * 0.6;
    const innerRadius = cornerRadius * 0.4;

    return (
      <g key={`finder-${id}`}>
        <defs>
          <mask id={`finder-mask-${id}`}>
            <rect x={x} y={y} width={outerSize} height={outerSize} rx={cornerRadius} ry={cornerRadius} fill="white" />
            <rect x={x + middleOffset} y={y + middleOffset} width={middleSize} height={middleSize} rx={middleRadius} ry={middleRadius} fill="black" />
            <rect x={x + innerOffset} y={y + innerOffset} width={innerSize} height={innerSize} rx={innerRadius} ry={innerRadius} fill="white" />
          </mask>
        </defs>
        <rect x={x} y={y} width={outerSize} height={outerSize} fill="black" mask={`url(#finder-mask-${id})`} />
      </g>
    );
  };

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      {modules.map((row, rowIndex) =>
        row.map((cell, colIndex) => {
          if (!cell) return null;
          if (isFinderPattern(rowIndex, colIndex)) return null;
          if (isCenterArea(rowIndex, colIndex)) return null;

          return (
            <rect
              key={`${rowIndex}-${colIndex}`}
              x={colIndex * cellSize}
              y={rowIndex * cellSize}
              width={cellSize}
              height={cellSize}
              fill="black"
            />
          );
        })
      )}

      {renderFinderPattern(0, 0, "tl")}
      {renderFinderPattern(0, moduleCount - finderSize, "tr")}
      {renderFinderPattern(moduleCount - finderSize, 0, "bl")}

      {/* Center logo */}
      <image
        href={logoSrc}
        x={(size - logoSize) / 2}
        y={(size - logoSize) / 2}
        width={logoSize}
        height={logoSize}
      />
    </svg>
  );
}

// Format address with emphasized first/last 4 chars
function FormattedAddress({ address }: { address: string }) {
  const first = address.slice(0, 4);
  const middle = address.slice(4, -4);
  const last = address.slice(-4);

  return (
    <span className="font-mono text-[15px] leading-5 break-all text-center">
      <span className="text-black font-medium">{first}</span>
      <span style={{ color: "rgba(60, 60, 67, 0.6)" }}>{middle}</span>
      <span className="text-black font-medium">{last}</span>
    </span>
  );
}

// Copy icon (light theme)
const CopyIcon = () => (
  <svg width="28" height="28" viewBox="0 0 28 28" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M19.8333 10.5H11.6667C10.3779 10.5 9.33333 11.5446 9.33333 12.8333V21C9.33333 22.2887 10.3779 23.3333 11.6667 23.3333H19.8333C21.1221 23.3333 22.1667 22.2887 22.1667 21V12.8333C22.1667 11.5446 21.1221 10.5 19.8333 10.5Z" stroke="#3C3C43" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
    <path d="M8.16667 17.5C6.88333 17.5 5.83333 16.45 5.83333 15.1667V7C5.83333 5.71667 6.88333 4.66667 8.16667 4.66667H16.3333C17.6167 4.66667 18.6667 5.71667 18.6667 7" stroke="#3C3C43" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
  </svg>
);

// Share icon (light theme)
const ShareIcon = () => (
  <svg width="28" height="28" viewBox="0 0 28 28" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M14 2.33333V17.5" stroke="#3C3C43" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
    <path d="M9.33333 7L14 2.33333L18.6667 7" stroke="#3C3C43" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
    <path d="M23.3333 14V22.1667C23.3333 22.7855 23.0875 23.379 22.6499 23.8166C22.2123 24.2542 21.6188 24.5 21 24.5H7C6.38116 24.5 5.78767 24.2542 5.35008 23.8166C4.9125 23.379 4.66667 22.7855 4.66667 22.1667V14" stroke="#3C3C43" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
  </svg>
);

export type ReceiveSheetProps = {
  trigger?: React.ReactNode | null;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  walletAddress?: string;
};

const COPIED_RESET_TIMEOUT = 2000;

export default function ReceiveSheet({
  open,
  onOpenChange,
  walletAddress: propAddress,
}: ReceiveSheetProps) {
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

  const [copied, setCopied] = useState(false);
  const [address, setAddress] = useState<string | null>(propAddress || null);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

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
    const timeoutId = window.setTimeout(() => setCopied(false), COPIED_RESET_TIMEOUT);
    return () => window.clearTimeout(timeoutId);
  }, [copied]);

  // Load wallet address
  useEffect(() => {
    if (propAddress) {
      setAddress(propAddress);
      return;
    }

    let isMounted = true;
    const loadAddress = async () => {
      setIsLoading(true);
      try {
        const publicKey = await getWalletPublicKey();
        if (isMounted) setAddress(publicKey.toBase58());
      } catch (error) {
        console.error("Failed to fetch wallet address", error);
        if (isMounted) setAddress(null);
      } finally {
        if (isMounted) setIsLoading(false);
      }
    };
    void loadAddress();
    return () => { isMounted = false; };
  }, [propAddress]);

  const unmount = useCallback(() => {
    setRendered(false);
    setShow(false);
    onOpenChange?.(false);
    isClosing.current = false;
  }, [onOpenChange]);

  const closeSheet = useCallback(() => {
    if (isClosing.current) return;
    isClosing.current = true;
    hideAllButtons();
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

  const copyAddress = useCallback(async () => {
    if (!address) return;
    if (hapticFeedback.impactOccurred.isAvailable()) {
      hapticFeedback.impactOccurred("light");
    }
    try {
      if (!navigator?.clipboard?.writeText) {
        throw new Error("Clipboard API is not available");
      }
      await navigator.clipboard.writeText(address);
      setCopied(true);
      if (hapticFeedback.notificationOccurred.isAvailable()) {
        hapticFeedback.notificationOccurred("success");
      }
    } catch (error) {
      console.error("Failed to copy wallet address", error);
      if (hapticFeedback.notificationOccurred.isAvailable()) {
        hapticFeedback.notificationOccurred("error");
      }
    }
  }, [address]);

  const shareAddress = useCallback(() => {
    if (!address) return;
    if (hapticFeedback.impactOccurred.isAvailable()) {
      hapticFeedback.impactOccurred("light");
    }
    if (shareURL.isAvailable()) {
      shareURL(getSolscanAccountUrl(address), `My Solana wallet address:\n${address}`);
    } else {
      void copyAddress();
    }
  }, [address, copyAddress]);

  // Lock body scroll
  useEffect(() => {
    if (rendered) {
      document.body.style.overflow = "hidden";
      return () => { document.body.style.overflow = ""; };
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
        className="fixed left-0 right-0 bottom-0 z-[9999] flex flex-col bg-white rounded-t-[38px] font-sans max-w-md mx-auto"
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

        {/* Header — also draggable */}
        <div
          className="relative h-[44px] flex items-center justify-center shrink-0 px-4"
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleTouchEnd}
        >
          <span className="text-[17px] font-semibold text-black leading-[22px]">
            Receive
          </span>

          <button
            onClick={closeSheet}
            className="absolute right-3 w-[30px] h-[30px] rounded-full flex items-center justify-center active:scale-95 transition-all duration-150"
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
          <div className="flex flex-col items-center pt-8">
            {/* Solana Icon */}
            <div className="w-[52px] h-[52px] relative mb-4">
              <Image
                src="/tokens/solana-sol-logo.png"
                alt="Solana"
                fill
                className="object-contain"
              />
            </div>

            {/* Warning Text */}
            <p
              className="text-center text-[15px] leading-5 mb-8 max-w-[320px] px-2"
              style={{ color: "rgba(60, 60, 67, 0.6)" }}
            >
              Use to receive tokens on the Solana network only.{" "}
              Other assets will be lost forever.
            </p>

            {/* QR + Buttons column — fixed 256px width */}
            <div className="w-[256px] flex flex-col items-center">
              {/* QR Code Card */}
              <div
                className="rounded-[20px] w-full flex flex-col items-center pt-8 pb-5 mb-8"
                style={{ background: "#f2f2f7" }}
              >
                {address ? (
                  <>
                    <StyledQRCode
                      value={address}
                      size={192}
                      logoSrc="/dogs/dog-default.png"
                      logoSize={48}
                    />
                    <div className="mt-4 px-4 w-full">
                      <FormattedAddress address={address} />
                    </div>
                  </>
                ) : (
                  <div className="w-[192px] h-[192px] flex items-center justify-center">
                    <span style={{ color: "rgba(60, 60, 67, 0.6)" }}>
                      {isLoading ? "Loading..." : "No address"}
                    </span>
                  </div>
                )}
              </div>

              {/* Action Buttons — spread to match address width */}
              <div className="flex w-full justify-between px-4">
                {/* Copy Button */}
                <button
                  onClick={copyAddress}
                  disabled={!address || isLoading}
                  className="flex flex-col gap-2 items-center active:opacity-70 transition-opacity disabled:opacity-50"
                >
                  <div
                    className="w-[56px] h-[56px] rounded-full flex items-center justify-center"
                    style={{ background: "rgba(249, 54, 60, 0.14)" }}
                  >
                    <CopyIcon />
                  </div>
                  <span
                    className="text-[13px]"
                    style={{ color: "rgba(60, 60, 67, 0.6)" }}
                  >
                    {copied ? "Copied!" : "Copy"}
                  </span>
                </button>

                {/* Share Button */}
                <button
                  onClick={shareAddress}
                  disabled={!address || isLoading}
                  className="flex flex-col gap-2 items-center active:opacity-70 transition-opacity disabled:opacity-50"
                >
                  <div
                    className="w-[56px] h-[56px] rounded-full flex items-center justify-center"
                    style={{ background: "rgba(249, 54, 60, 0.14)" }}
                  >
                    <ShareIcon />
                  </div>
                  <span
                    className="text-[13px]"
                    style={{ color: "rgba(60, 60, 67, 0.6)" }}
                  >
                    Share
                  </span>
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );

  return createPortal(content, document.body);
}
