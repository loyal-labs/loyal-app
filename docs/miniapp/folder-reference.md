# Folder Reference

Detailed breakdown of `/app/src/lib/`.

---

## Root Files

### `constants.ts`

| Constant | Source | Purpose |
|----------|--------|---------|
| `PUBLIC_KEY_STORAGE_KEY` | Hardcoded | Cloud storage key: `"solana_public_key"` |
| `SECRET_KEY_STORAGE_KEY` | Hardcoded | Cloud storage key: `"solana_secret_key"` |
| `TELEGRAM_BOT_ID` | Env var | From `NEXT_PUBLIC_TELEGRAM_BOT_ID` |
| `TELEGRAM_PUBLIC_KEYS` | Hardcoded | Test + prod keys for signature verification |
| `DEPOSIT_SEED` | Hardcoded | PDA seed: `"deposit"` |
| `VAULT_SEED` | Hardcoded | PDA seed: `"vault"` |
| `SESSION_SEED` | Hardcoded | PDA seed: `"tg_session"` |
| `SOL_PRICE_USD` | Hardcoded | Fallback price (use MagicBlock for live) |
| `STARS_FEE_AMOUNT` | Hardcoded | `2000` Stars (testing value) |
| `STARS_TO_USD` | Hardcoded | `0.013` conversion rate |

### `utils.ts`

Single function for Tailwind CSS class merging:

```typescript
cn(...inputs) // Merges classes, resolves conflicts
```

---

## `/core`

HTTP, database, and storage/CDN utilities.

| File | Exports | Description |
|------|---------|-------------|
| `http.ts` | `fetchJson()`, `fetchStream()` | Typed fetch wrappers |
| `api.ts` | `resolveEndpoint()` | Builds URLs from `publicEnv.serverHost` (`NEXT_PUBLIC_SERVER_HOST`) |
| `database.ts` | `getDatabase()` | App-local DB singleton using shared `@loyal-labs/db-core` schema and `@loyal-labs/db-adapter-neon` |
| `r2-upload.ts` | `createCloudflareR2UploadClient()`, `getCloudflareR2UploadClientFromEnv()` | Server-side Cloudflare R2 image upload client |
| `cdn-url.ts` | `createCloudflareCdnUrlClient()`, `getCloudflareCdnUrlClientFromEnv()` | Resolves public CDN URLs from object keys |
| `config/public.ts` | `publicEnv` | Public env access (`NEXT_PUBLIC_*`) |
| `config/server.ts` | `serverEnv` | Server-only env access (`server-only`) |
| `config/shared.ts` | parsing helpers | Shared env normalization helpers |

### `r2-upload.ts` (server-side only)

Minimal upload client for Cloudflare R2 (S3-compatible API), intended for use in API routes and other server functions.

**Key exports:**
- `isCloudflareR2UploadConfigured()` - checks required env vars
- `getCloudflareR2UploadClientFromEnv()` - lazy singleton from env config
- `createCloudflareR2UploadClient(config)` - explicit client factory
- `uploadImage({ key, body, contentType, ... })` - uploads image bytes to a bucket key

**Behavior:**
- Keys are normalized (`a//b/` -> `a/b`)
- Unsafe path segments (`.` or `..`) are rejected

**Required env vars:**
- `CLOUDFLARE_R2_ACCOUNT_ID`
- `CLOUDFLARE_R2_ACCESS_KEY_ID`
- `CLOUDFLARE_R2_SECRET_ACCESS_KEY`
- `CLOUDFLARE_R2_BUCKET_NAME`

**Optional env vars:**
- `CLOUDFLARE_R2_S3_ENDPOINT` (defaults to `https://<account_id>.r2.cloudflarestorage.com`)
- `CLOUDFLARE_R2_UPLOAD_PREFIX` (prepends a key prefix like `telegram/photos`)

### `cdn-url.ts`

Small URL resolver client for converting object keys into public CDN URLs.

**Key exports:**
- `createCloudflareCdnUrlClient(config)` - explicit client factory
- `getCloudflareCdnUrlClientFromEnv()` - lazy singleton from env config
- `resolveUrl({ key, query })` - resolves one URL
- `resolveUrls(keys, { query })` - resolves many URLs

**Behavior:**
- Keys are normalized consistently with the upload client
- Path segments are URL-encoded and unsafe segments (`.`/`..`) are rejected

**Base URL resolution order (`getCloudflareCdnUrlClientFromEnv`)**:
1. `CLOUDFLARE_CDN_BASE_URL`
2. `NEXT_PUBLIC_CLOUDFLARE_CDN_BASE_URL`
3. `CLOUDFLARE_R2_PUBLIC_DEV_URL`
4. `NEXT_PUBLIC_CLOUDFLARE_R2_PUBLIC_DEV_URL`

---

## `/encryption`

Server-side AES-256-GCM encryption for personal messages.

| File | Exports | Description |
|------|---------|-------------|
| `encrypt.ts` | `encrypt()` | Encrypts plaintext, returns `{ ciphertext, iv }` |
| `decrypt.ts` | `decrypt()` | Decrypts data, returns plaintext or `null` on failure |
| `types.ts` | `EncryptedData` | TypeScript interface for encrypted payload |

**JSONB storage type:** `EncryptedMessageContent` (defined in `@loyal-labs/db-core/schema`) extends `EncryptedData` with:
- `type`: Content discriminator (`"text"`, `"image"`, `"voice"`)
- `metadata`: Optional metadata preserved unencrypted (file name, size, duration)

**Configuration:**

| Item | Source | Description |
|------|--------|-------------|
| Algorithm | Hardcoded | AES-256-GCM via Web Crypto API |
| Key | Env var | `MESSAGE_ENCRYPTION_KEY` (base64-encoded 32 bytes) |
| IV | Generated | Random 12 bytes per encryption |

**Usage:**

```typescript
import { encrypt, decrypt } from "@/lib/encryption";

// Encrypt
const encrypted = await encrypt("secret message");
// { ciphertext: "base64...", iv: "base64..." }

// Decrypt
const plaintext = await decrypt(encrypted);
// "secret message" or null if tampered/invalid
```

**Security features:**
- Unique IV per encryption (same plaintext produces different ciphertext)
- GCM authentication tag detects tampering
- Returns `null` on any failure (no error details exposed)

---

## `/solana`

Solana blockchain integration.

### `/solana/rpc/`

RPC connection management using Helius endpoints (mainnet/devnet) or local validator (localnet).

| Constant | Source | Value |
|----------|--------|-------|
| `SECURE_MAINNET_RPC_URL` | Hardcoded | Helius mainnet endpoint |
| `TESTNET_RPC_URL` | Hardcoded | Solana testnet endpoint |
| `SECURE_DEVNET_RPC_URL` | Hardcoded | Helius devnet endpoint |
| `LOCALNET_RPC_URL` | Hardcoded | `http://127.0.0.1:8899` |

Selected by `NEXT_PUBLIC_SOLANA_ENV`:
- `"mainnet"` - Production (Helius)
- `"testnet"` - Test network
- `"devnet"` - Testing (Helius, default)
- `"localnet"` - Local development (`solana-test-validator`)

**Key exports:** `getConnection()`, `getWebsocketConnection()`, `getSolanaEnv()`

**Type exports:** `SolanaEnv` - Union type for valid environment values

### `/solana/wallet/`

Wallet keypair management. Keypairs stored in **Telegram Cloud Storage** (not localStorage).

**Key exports:** `ensureWalletKeypair()`, `getWalletBalance()`, `sendSolTransaction()`

#### `subscribe-wallet-asset-changes.ts`

Subscribes to WebSocket changes that can affect a wallet's portfolio value:
- Native SOL (system account)
- SPL Token accounts (Token program)
- SPL Token-2022 accounts (Token-2022 program)

Emits debounced `onChange()` callbacks to avoid refetch storms when multiple account updates arrive in quick succession.

**Key export:** `subscribeToWalletAssetChanges(walletAddress, onChange, options?)`

**Options:**

| Option | Default | Description |
|--------|---------|-------------|
| `commitment` | `"confirmed"` | Solana commitment level |
| `debounceMs` | `750` | Debounce interval for change callbacks |
| `includeNative` | `true` | Subscribe to native SOL changes (disable if already subscribed elsewhere) |

**Usage:**

```typescript
import { subscribeToWalletAssetChanges } from "@/lib/solana/wallet/subscribe-wallet-asset-changes";

const unsubscribe = await subscribeToWalletAssetChanges(
  walletAddress,
  () => { void refreshTokenHoldings(true); },
  { debounceMs: 750, commitment: "confirmed" }
);

// Cleanup
await unsubscribe();
```

### `/solana/deposits/`

Deposit/claim logic using Anchor programs and PDAs.

**Key exports:** `getDeposit()`, `claimDeposit()`, `refundDeposit()`, `topUpDeposit()`

### `/solana/verification/`

On-chain Telegram signature verification using Ed25519.

**Key exports:** `verifyInitData()`, `storeInitData()`, `fetchSessionData()`

### `/solana/token-holdings/`

Fetches all fungible token holdings (SPL tokens + native SOL) with USD prices via Helius DAS API.

| Constant | Value | Description |
|----------|-------|-------------|
| `CACHE_TTL_MS` | `30000` | Cache duration (30 seconds) |
| `NATIVE_SOL_MINT` | `So111...112` | Native SOL mint address |
| `NATIVE_SOL_DECIMALS` | `9` | SOL decimal places |

**Key exports:** `fetchTokenHoldings(publicKey, forceRefresh?)`, `computePortfolioTotals(holdings, fallbackSolPriceUsd)`

**Type exports:** `TokenHolding`, `PortfolioTotals`

```typescript
type TokenHolding = {
  mint: string;           // Token mint address
  symbol: string;         // e.g. "SOL", "USDC"
  name: string;           // e.g. "Solana", "USD Coin"
  balance: number;        // Human-readable balance
  decimals: number;       // Token decimals
  priceUsd: number | null;  // Price per token (null if unavailable)
  valueUsd: number | null;  // Total value (null if unavailable)
};

type PortfolioTotals = {
  totalUsd: number;                  // Sum of all priced holdings (floor to 2 decimals)
  totalSol: number | null;           // totalUsd / SOL price (floor to 4 decimals), null if no SOL price
  pricedCount: number;               // Holdings with a known USD value
  unpricedCount: number;             // Holdings without price data
  effectiveSolPriceUsd: number | null; // SOL price used (from holdings → fallback → constant)
};
```

**Usage:**

```typescript
import { fetchTokenHoldings, computePortfolioTotals } from "@/lib/solana/token-holdings";

const holdings = await fetchTokenHoldings("ADDRESS");
const totals = computePortfolioTotals(holdings, solPriceUsd);
// totals.totalUsd  — portfolio value in USD
// totals.totalSol  — portfolio value in SOL
```

**Notes:**
- Returns cached data for 30s (use `forceRefresh: true` to bypass)
- Concurrent requests are coalesced (even forced refreshes share an in-flight request)
- Returns empty array on localnet (DAS API unavailable)
- Price data available for top 10k tokens by volume
- `computePortfolioTotals` resolves SOL price via a fallback chain: holdings price → passed-in `fallbackSolPriceUsd` → `SOL_PRICE_USD` constant

### `solana-helpers.ts`

Anchor program initialization and PDA derivation.

**Key exports:** `getDepositPda()`, `getVaultPda()`

---

## `/telegram`

Telegram platform integration split into client and server.

### `/telegram/mini-app/` (Client-side)

For browser/mini app context.

| File | Purpose |
|------|---------|
| `index.ts` | SDK init, safe area handling |
| `cloud-storage.ts` | Telegram Cloud Storage wrapper |
| `tma-auth.ts` | Auth headers for API requests |
| `share-message.ts` | Message sharing |
| `verify-init-data.ts` | Client-side signature verification |

**Constant:** `CHANNEL_LINK = "https://t.me/loyal_tg"`

### `/telegram/bot-api/` (Server-side)

For API routes. Requires `ASKLOYAL_TGBOT_KEY` env var.
`/api/telegram/setup-commands` additionally uses `TELEGRAM_SETUP_SECRET` for route auth.

| Constant | Value |
|----------|-------|
| `CHANNEL_USERNAME` | `"@loyal_tg"` |
| `MINI_APP_LINK` | `"https://t.me/askloyal_tgbot/app"` |
| `CUSTOM_EMOJI_ID` | `"5361803602862052361"` |

**Key exports:** `getBot()`, `sendMessage()`, `createInvoiceLink()`

### `/telegram/bot-thread-service.ts`

Service layer for threaded bot conversations with encrypted message storage.

| Export | Description |
|--------|-------------|
| `getOrCreateThread()` | Idempotent thread creation by Telegram context |
| `addMessage()` | Store encrypted message with atomic thread update |
| `getThreadMessages()` | Retrieve decrypted messages chronologically |
| `getThreadMessagesForAI()` | Format messages for LLM context |
| `getThread()` | Get thread by UUID |
| `updateThread()` | Update title/status |
| `getUserLatestThread()` | Get user's most recent thread |
| `getThreadMessageCount()` | Efficient SQL COUNT |

**Type exports:** `TextContent`, `ImageContent`, `VoiceContent`, `MessageContent`, `DecryptedMessage`

**Usage:**

```typescript
import {
  getOrCreateThread,
  addMessage,
  getThreadMessagesForAI
} from "@/lib/telegram/bot-thread-service";
import { chatCompletion } from "@/lib/redpill";

// Create or find thread
const threadId = await getOrCreateThread({
  userId,
  telegramChatId: BigInt(chatId),
  telegramThreadId: ctx.message.message_thread_id,
});

// Store user message (encrypted)
await addMessage({
  threadId,
  senderType: "user",
  content: ctx.message.text,
});

// Get AI context and respond
const history = await getThreadMessagesForAI(threadId);
const response = await chatCompletion({
  model: "phala/gpt-oss-120b",
  messages: [{ role: "system", content: "..." }, ...history],
});

// Store bot response (encrypted)
await addMessage({
  threadId,
  senderType: "bot",
  content: response.choices[0].message.content,
});
```

---

## `/magicblock`

MagicBlock integration for live SOL/USD price via Pyth Lazer oracle.

| Constant | Source | Value |
|----------|--------|-------|
| `MAGICBLOCK_DEVNET_RPC_URL` | Hardcoded | `https://devnet.magicblock.app` |
| `PRICE_PROGRAM_ID` | Hardcoded | Pyth price program address |
| `SOLANA_PYTH_LAZER_ID` | Hardcoded | `6` (SOL/USD feed) |

**Key export:** `fetchSolUsdPrice()` - Returns current SOL price in USD

Note: On localnet, MagicBlock uses devnet as a fallback for price data.

---

## `/ai`

Ax-based program layer for summary generation and evaluation.

### `/ai/ax/programs/summaries/`

| File | Purpose |
|------|---------|
| `spec.ts` | Program spec: signatures, examples, assertions, model defaults |
| `generate.ts` | `createAxSummaryGenerationService()` orchestration |
| `types.ts` | Summary generation contracts and typed signature shapes |
| `validation.ts` | Shared normalization and validation rules |
| `assets/examples/v1.json` | Versioned few-shot examples |
| `assets/rules/v1.json` | Versioned quality rules |

### `/ai/ax/evals/`

| File | Purpose |
|------|---------|
| `runner.ts` | Dataset/baseline regression runner (`bun run ai:eval:summaries`) |
| `datasets/summaries-v1.json` | Eval dataset |
| `datasets/summaries-v1-baseline.json` | Minimum metric thresholds |
| `metrics/summaries.ts` | Structural/source/oneliner metric computation |

### Runtime wiring

- `telegram/bot-api/summary-generation/service.ts` wires Ax services with Redpill endpoint + env config.
- `telegram/bot-api/summaries.ts` remains orchestration-only (idempotency, DB write, delivery).

---

## `/redpill`

Redpill API primitives used by non-Ax flows and endpoint constants used by Ax client wiring.

| Constant | Source |
|----------|--------|
| `REDPILL_BASE_URL` | Hardcoded: `https://api.redpill.ai/v1` |
| API Key | Env var: `REDPILL_AI_API_KEY` |

**Key exports:** `chatCompletion()`, `chatCompletionStream()`

Used directly by `telegram/streaming-service.ts`. Summary generation now routes through Ax (`/ai/ax/...`).
