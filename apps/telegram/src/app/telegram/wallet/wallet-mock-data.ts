import type { TokenHolding } from "@/lib/solana/token-holdings";
import type { Transaction } from "@/types/wallet";

// ─── Mock data for development ─────────────────────────────────────────────
export const USE_MOCK_DATA = false;

export const MOCK_WALLET_ADDRESS =
  "UQAt7f8Kq9xZ3mNpR2vL5wYcD4bJ6hTgSoAeWnFqZir";
export const MOCK_BALANCE_LAMPORTS = 1_267_476_540_000; // ~1267.47654 SOL
export const MOCK_SOL_PRICE_USD = 132.05;

export const MOCK_TOKEN_HOLDINGS: TokenHolding[] = [
  {
    mint: "usdt",
    symbol: "USDT",
    name: "Tether USD",
    balance: 1267,
    decimals: 6,
    priceUsd: 0.99,
    valueUsd: 1254.33,
    imageUrl: "/tokens/USDT.png",
  },
  {
    mint: "sol",
    symbol: "SOL",
    name: "Solana",
    balance: 1267,
    decimals: 9,
    priceUsd: 99.03,
    valueUsd: 125470.01,
    imageUrl: "/tokens/solana-sol-logo.png",
  },
  {
    mint: "bnb",
    symbol: "BNB",
    name: "BNB",
    balance: 1267,
    decimals: 8,
    priceUsd: 559.06,
    valueUsd: 708328.02,
    imageUrl: "/tokens/bnb-bnb-logo.png",
  },
  {
    mint: "usdc",
    symbol: "USDC",
    name: "USD Coin",
    balance: 1267,
    decimals: 6,
    priceUsd: 0.99,
    valueUsd: 1254.33,
    imageUrl: "/tokens/usd-coin-usdc-logo.png",
  },
  {
    mint: "wbtc",
    symbol: "WBTC",
    name: "Wrapped Bitcoin",
    balance: 1267,
    decimals: 8,
    priceUsd: 76375.83,
    valueUsd: 96764126.61,
    imageUrl: "/tokens/bitcoin-btc-logo.png",
  },
  {
    mint: "avax",
    symbol: "AVAX",
    name: "Avalanche",
    balance: 500,
    decimals: 18,
    priceUsd: 35.2,
    valueUsd: 17600,
    imageUrl: "/tokens/avalanche-avax-logo.png",
  },
  {
    mint: "usdt-secured",
    symbol: "USDT",
    name: "Tether USD",
    balance: 1267,
    decimals: 6,
    priceUsd: 0.99,
    valueUsd: 2.12,
    imageUrl: "/tokens/USDT.png",
    isSecured: true,
  },
];

// Extended mock transaction info for activity display
export type MockActivityInfo = {
  tokenSymbol: string;
  tokenIcon: string;
  displayAmount: string;
  subtitle: string;
  label: string;
};

export const MOCK_ACTIVITY_INFO: Record<string, MockActivityInfo> = {
  "mock-1": {
    tokenSymbol: "SOL",
    tokenIcon: "/tokens/solana-sol-logo.png",
    displayAmount: "+0.25 SOL",
    subtitle: "USDC to SOL",
    label: "Swap",
  },
  "mock-2": {
    tokenSymbol: "USDC",
    tokenIcon: "/tokens/usd-coin-usdc-logo.png",
    displayAmount: "+200.00 USDC",
    subtitle: "from UQAt...qZir",
    label: "Received",
  },
  "mock-3": {
    tokenSymbol: "USDT",
    tokenIcon: "/tokens/USDT.png",
    displayAmount: "−0.5 USDT",
    subtitle: "to UQAt...qZir",
    label: "Sent",
  },
  "mock-4": {
    tokenSymbol: "SOL",
    tokenIcon: "/tokens/solana-sol-logo.png",
    displayAmount: "−0.25 SOL",
    subtitle: "by UQAt...qZir",
    label: "To be claimed",
  },
  "mock-5": {
    tokenSymbol: "BNB",
    tokenIcon: "/tokens/bnb-bnb-logo.png",
    displayAmount: "−0.5 BNB",
    subtitle: "to UQAt...qZir",
    label: "Sent",
  },
  "mock-6": {
    tokenSymbol: "USDC",
    tokenIcon: "/tokens/usd-coin-usdc-logo.png",
    displayAmount: "+200.00 USDC",
    subtitle: "from UQAt...qZir",
    label: "Received",
  },
};

export const MOCK_WALLET_TRANSACTIONS: Transaction[] = [
  {
    id: "mock-1",
    type: "incoming",
    transferType: "swap",
    amountLamports: 250_000_000,
    sender: undefined,
    recipient: undefined,
    timestamp: Date.now() - 86400000 * 2,
    status: "completed",
    signature: "mock-sig-1",
    swapFromMint: "usdc",
    swapToMint: "sol",
    swapFromSymbol: "USDC",
    swapToSymbol: "SOL",
    swapToAmount: 0.25,
    swapToAmountUsd: 25.0,
  },
  {
    id: "mock-2",
    type: "incoming",
    transferType: "transfer",
    amountLamports: 500_000_000,
    sender: "UQAt...qZir",
    recipient: undefined,
    timestamp: Date.now() - 3600000,
    status: "completed",
    signature: "mock-sig-2",
  },
  {
    id: "mock-3",
    type: "outgoing",
    transferType: "transfer",
    amountLamports: 500_000_000,
    sender: undefined,
    recipient: "UQAt...qZir",
    timestamp: Date.now() - 86400000,
    status: "completed",
    signature: "mock-sig-3",
  },
  {
    id: "mock-4",
    type: "pending",
    transferType: "transfer_to_username_deposit",
    amountLamports: 250_000_000,
    sender: undefined,
    recipient: "UQAt...qZir",
    timestamp: Date.now() - 86400000 * 2,
    status: "pending",
    signature: "mock-sig-4",
  },
  {
    id: "mock-5",
    type: "outgoing",
    transferType: "transfer",
    amountLamports: 500_000_000,
    sender: undefined,
    recipient: "UQAt...qZir",
    timestamp: Date.now() - 86400000,
    status: "completed",
    signature: "mock-sig-5",
  },
  {
    id: "mock-6",
    type: "incoming",
    transferType: "transfer",
    amountLamports: 500_000_000,
    sender: "UQAt...qZir",
    recipient: undefined,
    timestamp: Date.now() - 3600000,
    status: "completed",
    signature: "mock-sig-6",
  },
  {
    id: "mock-7",
    type: "outgoing",
    transferType: "secure",
    amountLamports: 0,
    sender: undefined,
    recipient: undefined,
    timestamp: Date.now() - 7200000,
    status: "completed",
    signature: "mock-sig-7",
    secureTokenSymbol: "USDC",
    secureTokenIcon: "/tokens/usd-coin-usdc-logo.png",
    secureAmount: 15.0001,
    secureAmountUsd: 2869.77,
  },
  {
    id: "mock-8",
    type: "outgoing",
    transferType: "unshield",
    amountLamports: 0,
    sender: undefined,
    recipient: undefined,
    timestamp: Date.now() - 10800000,
    status: "completed",
    signature: "mock-sig-8",
    secureTokenSymbol: "USDT",
    secureTokenIcon: "/tokens/USDT.png",
    secureAmount: 15000.01,
    secureAmountUsd: 15000.01,
  },
];
// ─── End mock data ─────────────────────────────────────────────────────────
