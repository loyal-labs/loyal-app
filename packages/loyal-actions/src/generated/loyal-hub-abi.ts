// Generated from crates/loyal-hub-abi/schema/loyal_hub_abi.schema.
// Run `bun run generate:abi` in packages/loyal-actions after schema changes.

export const CONFIG_SEED = new Uint8Array([99, 111, 110, 102, 105, 103]);
export const HUB_AUTHORITY_SEED = new Uint8Array([
  104, 117, 98, 45, 97, 117, 116, 104, 111, 114, 105, 116, 121,
]);
export const MAX_ALLOWED_MINTS = 16;
export const MAX_REBALANCE_TRANSFERS = 16;
export const MAX_FEE_BPS = 10000;
export const SWAP_EXACT_IN = 1;
export const SWAP_EXACT_IN_TAG_OFFSET = 0;
export const SWAP_EXACT_IN_MAX_FEE_BPS_DATA_OFFSET = 25;

export const swapExactInAccounts = {
  CONFIG: 0,
  USER_VAULT: 1,
  USER_INPUT: 2,
  USER_OUTPUT: 3,
  HUB_INPUT: 4,
  HUB_OUTPUT: 5,
  INPUT_MINT: 6,
  OUTPUT_MINT: 7,
  HUB_AUTHORITY: 8,
  HUB_AUTHORIZER: 9,
  TOKEN_PROGRAM: 10,
} as const;
