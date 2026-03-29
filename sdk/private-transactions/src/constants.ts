import { PublicKey, LAMPORTS_PER_SOL } from "@solana/web3.js";

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

/**
 * Telegram Private Transfer program ID
 */
export const PROGRAM_ID = new PublicKey(
  "97FzQdWi26mFNR21AbQNg4KqofiCLqQydQfAvRQMcXhV"
);

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
 * Kamino Lend program ID
 */
export const KLEND_PROGRAM_ID = new PublicKey(
  "KLend2g3cP87fffoy8q1mQqGKjrxjC8boSyAYavgmjD"
);

/**
 * Supported mainnet Kamino lending markets / reserves
 */
export const KLEND_MAIN_MARKET = new PublicKey(
  "7u3HeHxYDLhnCoErrtycNokbQYbWGzLs6JSDqGAv5PfF"
);
export const KLEND_ALT_MARKET = new PublicKey(
  "CqAoLuqWtavaVE8deBjMKe8ZfSt9ghR6Vb8nfsyabyHA"
);
export const WSOL_MINT = new PublicKey(
  "So11111111111111111111111111111111111111112"
);
export const USDC_MINT = new PublicKey(
  "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"
);
export const USDT_MINT = new PublicKey(
  "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB"
);
export const KLEND_SOL_RESERVE = new PublicKey(
  "d4A2prbA2whesmvHaL88BH6Ewn5N4bTSU2Ze8P6Bc4Q"
);
export const KLEND_USDC_RESERVE = new PublicKey(
  "9GJ9GBRwCp4pHmWrQ43L5xpc9Vykg7jnfwcFGN8FoHYu"
);
export const KLEND_USDT_RESERVE = new PublicKey(
  "H3t6qZ1JkguCNTi9uzVKqQ7dvt2cum4XiXWom6Gn5e5S"
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
export const USERNAME_DEPOSIT_SEED = "username_deposit";
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
