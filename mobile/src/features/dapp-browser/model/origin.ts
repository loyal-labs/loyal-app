import { TRUSTED_DAPPS } from "./trusted-dapps";
import type { DappTrustState } from "./types";

export function coerceBrowserUrl(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
    return trimmed;
  }
  return `https://${trimmed}`;
}

export function normalizeOrigin(url: string): string {
  const parsed = new URL(url);
  return parsed.origin;
}

export function buildOriginFaviconUrl(origin: string): string {
  return new URL("/favicon.ico", origin).toString();
}

export function getTrustState(
  origin: string,
  connectedOrigins: string[],
): DappTrustState {
  if (TRUSTED_DAPPS.some((dapp) => dapp.origin === origin)) return "trusted";
  if (connectedOrigins.includes(origin)) return "connected";
  return "untrusted";
}
