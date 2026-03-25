"use client";

import { ArrowLeft, Check, Copy, X } from "lucide-react";
import Image from "next/image";
import { QRCodeSVG } from "qrcode.react";
import { useCallback, useState } from "react";

import { getTokenIconUrl } from "@/lib/token-icon";

const font = "var(--font-geist-sans), sans-serif";
const secondary = "rgba(60, 60, 67, 0.6)";

export function ReceiveContent({
  walletAddress,
  onBack,
  onClose,
}: {
  walletAddress: string | null;
  onBack?: () => void;
  onClose: () => void;
}) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(() => {
    if (!walletAddress) return;
    void navigator.clipboard.writeText(walletAddress);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [walletAddress]);

  const address = walletAddress ?? "";

  return (
    <>
      <style jsx>{`
        .receive-back:hover, .receive-close:hover {
          background: rgba(0, 0, 0, 0.08) !important;
        }
        .receive-copy-btn:hover {
          background: rgba(0, 0, 0, 0.85) !important;
        }
      `}</style>

      {/* Header */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "8px",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", flex: 1 }}>
          {onBack && (
            <button
              className="receive-back"
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
          )}
          <div
            style={{
              paddingLeft: onBack ? "8px" : "12px",
              paddingTop: "4px",
              paddingBottom: "4px",
            }}
          >
            <span
              style={{
                fontFamily: font,
                fontSize: "18px",
                fontWeight: 600,
                lineHeight: "28px",
                color: "#000",
              }}
            >
              Receive
            </span>
          </div>
        </div>
        <button
          className="receive-close"
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
            flexShrink: 0,
          }}
          type="button"
        >
          <X size={24} />
        </button>
      </div>

      {/* Body */}
      <div
        style={{
          flex: 1,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          padding: "0 24px",
          overflow: "auto",
        }}
      >
        {/* Solana icon + warning */}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: "16px",
            marginTop: "60px",
          }}
        >
          <Image
            alt="Solana"
            height={52}
            src={getTokenIconUrl("SOL")}
            style={{ borderRadius: "9999px" }}
            width={52}
          />
          <p
            style={{
              fontFamily: font,
              fontSize: "14px",
              fontWeight: 400,
              lineHeight: "20px",
              color: secondary,
              textAlign: "center",
              maxWidth: "318px",
            }}
          >
            Use to receive tokens on the Solana network only. Other assets will
            be lost forever.
          </p>
        </div>

        {/* QR Code card */}
        <div
          style={{
            marginTop: "24px",
            background: "#fff",
            borderRadius: "20px",
            padding: "32px",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: "16px",
            width: "100%",
            maxWidth: "280px",
          }}
        >
          {address ? (
            <div style={{ position: "relative" }}>
              <QRCodeSVG
                bgColor="transparent"
                fgColor="#000"
                level="M"
                size={192}
                value={address}
              />
              {/* Dog logo in center */}
              <div
                style={{
                  position: "absolute",
                  top: "50%",
                  left: "50%",
                  transform: "translate(-50%, -50%)",
                  width: "40px",
                  height: "32px",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  background: "#fff",
                  borderRadius: "4px",
                  padding: "2px",
                }}
              >
                <Image
                  alt="Loyal"
                  height={28}
                  src="/hero-new/Dog.svg"
                  width={36}
                />
              </div>
            </div>
          ) : (
            <div
              style={{
                width: "192px",
                height: "192px",
                background: "rgba(0,0,0,0.04)",
                borderRadius: "8px",
              }}
            />
          )}
          <p
            style={{
              fontFamily: font,
              fontSize: "13px",
              fontWeight: 400,
              lineHeight: "18px",
              color: secondary,
              textAlign: "center",
              wordBreak: "break-all",
            }}
          >
            {address || "No wallet connected"}
          </p>
        </div>
      </div>

      {/* Copy Address button */}
      <div style={{ padding: "16px 20px" }}>
        <button
          className="receive-copy-btn"
          disabled={!address}
          onClick={handleCopy}
          style={{
            width: "100%",
            padding: "12px 16px",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: "8px",
            background: "#000",
            border: "none",
            borderRadius: "9999px",
            cursor: address ? "pointer" : "not-allowed",
            opacity: address ? 1 : 0.4,
            transition: "background 0.2s ease",
          }}
          type="button"
        >
          {copied ? (
            <Check size={20} style={{ color: "#fff" }} />
          ) : (
            <Copy size={20} style={{ color: "#fff" }} />
          )}
          <span
            style={{
              fontFamily: font,
              fontSize: "16px",
              fontWeight: 400,
              lineHeight: "20px",
              color: "#fff",
            }}
          >
            {copied ? "Copied!" : "Copy Address"}
          </span>
        </button>
      </div>
    </>
  );
}
