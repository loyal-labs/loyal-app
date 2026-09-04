import { PublicKey } from "@solana/web3.js";

import type { Feed } from "./types";

export const MAGICBLOCK_DEVNET_RPC_URL = "https://devnet-tee.magicblock.app";

export const PRICE_PROGRAM_ID = new PublicKey(
  "PriCems5tHihc6UDXDjzjeawomAwBduWMGAi8ZUjppd"
);
export const SOLANA_PYTH_LAZER_ID = 6;
export const SOLANA_PYTH_EXPONENT = -8;
export const SOLANA_PYTH_LAZER_PRICE_OFFSET = 73;
export const SOLANA_PYTH_LAZER_SYMBOL = "Crypto.SOL/USD";
export const SOLANA_PYTH_LAZER_NAME = "SOLUSD";

export const SOLANA_FEED: Feed = {
  id: String(SOLANA_PYTH_LAZER_ID),
  name: SOLANA_PYTH_LAZER_NAME,
  symbol: SOLANA_PYTH_LAZER_SYMBOL,
  exponent: SOLANA_PYTH_EXPONENT,
  pythLazerId: SOLANA_PYTH_LAZER_ID,
};
