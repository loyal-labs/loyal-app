import { InlineKeyboard } from "grammy";

import type { JupiterTokenMetrics } from "@/lib/jupiter";

export const LOYAL_CA_ADDRESS = "LYLikzBQtpa9ZgVrJsqYGQpR3cC1WMJrBHaXGrQmeta";

function formatUsdValue(value: number | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return "N/A";
  }

  return `$${new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 3,
    minimumFractionDigits: 3,
  }).format(value)}`;
}

function formatIntegerValue(value: number | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return "N/A";
  }

  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 0,
  }).format(value);
}

function formatUpdatedAt(value: string | undefined): string {
  if (typeof value !== "string" || value.length < 19) {
    return "N/A";
  }

  const normalized = value.slice(0, 19).replace("T", " ");
  return normalized.length === 19 ? normalized : "N/A";
}

export function createCaCommandKeyboard(caAddress: string): InlineKeyboard {
  return new InlineKeyboard()
    .url("Jupiter", `https://jup.ag/tokens/${caAddress}`)
    .url("Dexscreener", `https://dexscreener.com/solana/${caAddress}`)
    .row()
    .copyText("Copy CA to clipboard", caAddress);
}

export function formatCaCommandMessage(
  caAddress: string,
  metrics?: JupiterTokenMetrics | null
): string {
  const caAddressMarkdown = `\`${caAddress}\``;
  const tokenInfoLines = [
    `Price: **${formatUsdValue(metrics?.priceUsd)}**`,
    `Market cap: **${formatUsdValue(metrics?.marketCapUsd)}**`,
    `FDV: **${formatUsdValue(metrics?.fdvUsd)}**`,
    `Holders: **${formatIntegerValue(metrics?.holderCount)}**`,
    `Liquidity: **${formatUsdValue(metrics?.liquidityUsd)}**`,
    `Updated: **${formatUpdatedAt(metrics?.updatedAt)}**`,
  ].join("\n");

  return `$LOYAL's CA: ${caAddressMarkdown}\n\n${tokenInfoLines}`;
}
