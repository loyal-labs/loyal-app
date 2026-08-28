"use client";

import { useState } from "react";

export const orbUrl = (value: string, type: "address" | "tx" = "address") =>
  `https://orbmarkets.io/${type}/${value}`;

export const shortSignature = (value: string) =>
  `${value.slice(0, 4)}…${value.slice(-4)}`;

export function OrbAddress({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);

  async function copyAddress() {
    await navigator.clipboard.writeText(value);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1_500);
  }

  return (
    <div className="address-control">
      <a
        href={orbUrl(value)}
        rel="noreferrer"
        target="_blank"
        title="View address on Orb Markets"
      >
        <span>{value}</span>
        <span aria-hidden="true" className="external-arrow">↗</span>
      </a>
      <button
        aria-label={copied ? `Copied ${value}` : `Copy ${value}`}
        className="copy-address"
        onClick={() => void copyAddress()}
        title={copied ? "Copied" : "Copy address"}
        type="button"
      >
        {copied ? (
          <svg aria-hidden="true" viewBox="0 0 16 16">
            <path d="m3 8 3 3 7-7" />
          </svg>
        ) : (
          <svg aria-hidden="true" viewBox="0 0 16 16">
            <rect height="9" rx="1" width="9" x="5" y="2" />
            <path d="M11 11v2a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h2" />
          </svg>
        )}
      </button>
    </div>
  );
}
