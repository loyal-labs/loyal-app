import {
  PublicKey,
  LAMPORTS_PER_SOL,
  SYSVAR_INSTRUCTIONS_PUBKEY,
} from "@solana/web3.js";

/**
 * TEE ER Validators
 */
export const ER_VALIDATOR_DEVNET = new PublicKey(
  "FnE6VJT5QNZdedZPnCoLsARgBwoE6DeJNjBs2H1gySXA"
);
export const ER_VALIDATOR_MAINNET = new PublicKey(
  "MTEWGuqxUpYZGFJQcp8tLN7x5v9BSeoFHYWQQ3n3xzo"
);
/**
 * Backward-compatible alias (defaults to devnet validator).
 */
export const ER_VALIDATOR = ER_VALIDATOR_DEVNET;

export function getErValidatorForSolanaEnv(env: string): PublicKey {
  return env === "mainnet" ? ER_VALIDATOR_MAINNET : ER_VALIDATOR_DEVNET;
}

export function getErValidatorForRpcEndpoint(rpcEndpoint: string): PublicKey {
  return rpcEndpoint.includes("mainnet-tee")
    ? ER_VALIDATOR_MAINNET
    : ER_VALIDATOR_DEVNET;
}

export function getKaminoModifyBalanceAccountsForTokenMint(
  tokenMint: PublicKey
): KaminoModifyBalanceAccounts | null {
  if (tokenMint.equals(USDC_MINT_MAINNET)) {
    return KAMINO_MODIFY_BALANCE_ACCOUNTS_MAINNET;
  }

  if (tokenMint.equals(USDC_MINT_DEVNET)) {
    return KAMINO_MODIFY_BALANCE_ACCOUNTS_DEVNET;
  }

  return null;
}

/**
 * Telegram Private Transfer program ID
 */
export const PROGRAM_ID = new PublicKey(
  "97FzQdWi26mFNR21AbQNg4KqofiCLqQydQfAvRQMcXhV"
);

export const USDC_MINT_DEVNET = new PublicKey(
  "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU"
);
export const USDC_MINT_MAINNET = new PublicKey(
  "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"
);

export const KLEND_PROGRAM_ID = new PublicKey(
  "KLend2g3cP87fffoy8q1mQqGKjrxjC8boSyAYavgmjD"
);

export interface KaminoModifyBalanceAccounts {
  lendingMarket: PublicKey;
  lendingMarketAuthority: PublicKey;
  reserve: PublicKey;
  reserveLiquiditySupply: PublicKey;
  reserveCollateralMint: PublicKey;
  instructionSysvarAccount: PublicKey;
  klendProgram: PublicKey;
}

const DEVNET_LENDING_MARKET = new PublicKey(
  "27MKCQo5qP7ijrwWSMKX2Jeb3PhK2NZmHQ9befWVRS4J"
);
const MAINNET_LENDING_MARKET = new PublicKey(
  "CqAoLuqWtavaVE8deBjMKe8ZfSt9ghR6Vb8nfsyabyHA"
);

const KAMINO_MODIFY_BALANCE_ACCOUNTS_DEVNET: KaminoModifyBalanceAccounts = {
  lendingMarket: DEVNET_LENDING_MARKET,
  lendingMarketAuthority: PublicKey.findProgramAddressSync(
    [Buffer.from("lma"), DEVNET_LENDING_MARKET.toBuffer()],
    KLEND_PROGRAM_ID
  )[0],
  reserve: new PublicKey("9uKMtFU9UJ9DfbwzCReGENb31appi79KTEeDGdCnvMjy"),
  reserveLiquiditySupply: new PublicKey(
    "Bh45cPkpfRvz9hAs23ye5TowsGbhbh4BXT4AGww8JfES"
  ),
  reserveCollateralMint: new PublicKey(
    "8GoBXfEq3aTiWTxEP2tAaygJMx3LhG764iN5e6gqaLA"
  ),
  instructionSysvarAccount: SYSVAR_INSTRUCTIONS_PUBKEY,
  klendProgram: KLEND_PROGRAM_ID,
};

const KAMINO_MODIFY_BALANCE_ACCOUNTS_MAINNET: KaminoModifyBalanceAccounts = {
  lendingMarket: MAINNET_LENDING_MARKET,
  lendingMarketAuthority: PublicKey.findProgramAddressSync(
    [Buffer.from("lma"), MAINNET_LENDING_MARKET.toBuffer()],
    KLEND_PROGRAM_ID
  )[0],
  reserve: new PublicKey("9GJ9GBRwCp4pHmWrQ43L5xpc9Vykg7jnfwcFGN8FoHYu"),
  reserveLiquiditySupply: new PublicKey(
    "H6JUwz8c61eQnYUx8avGXydKztKPyGvgWAUjmZUPS3BC"
  ),
  reserveCollateralMint: new PublicKey(
    "DKaVQFXD6Qz4USTkRWyPun3oU6r1RfYsWJ8YqLpnSnN5"
  ),
  instructionSysvarAccount: SYSVAR_INSTRUCTIONS_PUBKEY,
  klendProgram: KLEND_PROGRAM_ID,
};

export function isKaminoMainnetModifyBalanceAccounts(
  accounts: KaminoModifyBalanceAccounts
): boolean {
  return accounts.lendingMarket.equals(MAINNET_LENDING_MARKET);
}

/**
 * MagicBlock Delegation Program ID
 */
export const DELEGATION_PROGRAM_ID = new PublicKey(
  "DELeGGvXpWV2fqJUhqcF5ZSYMS4JTLjteaAMARRSaeSh"
);

/**
 * MagicBlock Permission Program ID (ACL)
 */
export const PERMISSION_PROGRAM_ID = new PublicKey(
  "ACLseoPoyC3cBqoUtkbjZ4aDrkurZW86v19pXz2XQnp1"
);

/**
 * MagicBlock Magic Program ID (for undelegation)
 */
export const MAGIC_PROGRAM_ID = new PublicKey(
  "Magic11111111111111111111111111111111111111"
);

/**
 * MagicBlock Magic Context Account (for undelegation)
 */
export const MAGIC_CONTEXT_ID = new PublicKey(
  "MagicContext1111111111111111111111111111111"
);

/**
 * PDA seed for deposit accounts
 */
export const DEPOSIT_SEED = "deposit_v2";
export const DEPOSIT_SEED_BYTES = Buffer.from(DEPOSIT_SEED);

/**
 * PDA seed for username deposit accounts
 */
export const USERNAME_DEPOSIT_SEED = "username_deposit_v2";
export const USERNAME_DEPOSIT_SEED_BYTES = Buffer.from(USERNAME_DEPOSIT_SEED);

/**
 * PDA seed for vault account
 */
export const VAULT_SEED = "vault";
export const VAULT_SEED_BYTES = Buffer.from(VAULT_SEED);

/**
 * PDA seed for permission accounts
 */
export const PERMISSION_SEED = "permission:";
export const PERMISSION_SEED_BYTES = Buffer.from(PERMISSION_SEED);

/**
 * Re-export LAMPORTS_PER_SOL for convenience
 */
export { LAMPORTS_PER_SOL };

/**
 * Convert SOL to lamports
 */
export function solToLamports(sol: number): number {
  return Math.floor(sol * LAMPORTS_PER_SOL);
}

/**
 * Convert lamports to SOL
 */
export function lamportsToSol(lamports: number): number {
  return lamports / LAMPORTS_PER_SOL;
}
