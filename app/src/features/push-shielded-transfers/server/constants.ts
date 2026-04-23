import "server-only";

export const PUSH_SHIELDED_TRANSFERS_SYNC_KEY =
  "push-shielded-transfers-mainnet";

// Head-scan budget per run. 3 pages × 100 sigs = 300 program signatures
// per tick, well above observed throughput. Keeps the cron bounded so a
// single run can't monopolize RPC.
export const MAX_HEAD_PAGES_PER_RUN = 3;
export const HISTORY_PAGE_LIMIT = 100;

// Batch size for getParsedTransactions — matches the analytics feature.
export const PARSED_TX_BATCH_SIZE = 10;

// Anchor account discriminator for the Deposit struct. Lifted from the
// telegram_private_transfer IDL ("accounts" → "Deposit" → "discriminator").
// Used to sanity-check we're deserializing a Deposit account before
// reading the user pubkey off the front.
export const DEPOSIT_DISCRIMINATOR = Uint8Array.from([
  148, 146, 121, 66, 207, 173, 21, 227,
]);
