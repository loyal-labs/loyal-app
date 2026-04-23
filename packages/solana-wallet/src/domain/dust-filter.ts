// Re-exports from @loyal-labs/shared so the predicates remain callable via
// @loyal-labs/solana-wallet (historical API surface) while the single source
// of truth lives in the shared package — mobile, which is outside the bun
// workspace, consumes shared directly.
export {
  isDustSolTransfer,
  isDustTokenTransfer,
  SOL_DUST_THRESHOLD_LAMPORTS,
  TOKEN_DUST_NORMALIZED_THRESHOLD,
} from "@loyal-labs/shared";
export type { SolDustInput, TokenDustInput } from "@loyal-labs/shared";
