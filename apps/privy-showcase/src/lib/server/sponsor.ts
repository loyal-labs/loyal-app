import "server-only";

import { createHash, randomBytes } from "node:crypto";
import { accounts, type PreparedLoyalSmartAccountsOperation } from "@loyal-labs/loyal-smart-accounts";
import { compilePreparedOperation, policyDiscriminator, toBigInt } from "@loyal-labs/loyal-smart-accounts-core";
import { createSmartAccountVaultsClient } from "@loyal-labs/smart-account-vaults";
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  VersionedTransaction,
} from "@solana/web3.js";
import { verifyAccessToken } from "@privy-io/node";
import bs58 from "bs58";
import {
  createRemoteJWKSet,
  jwtVerify,
  SignJWT,
  type JWTVerifyGetKey,
} from "jose";
import nacl from "tweetnacl";
import {
  assertMainnetRpcUrl,
  CANONICAL_USDC_MINT,
  DEMO_CLUSTER,
  EARN_VAULT_INDEX,
  SQUADS_PROGRAM_ID,
} from "../constants";
import { readDemoMoneyState, type DemoMoneyState } from "../money-state";
import { prepareTeardownStage, type TeardownStage } from "../policy-teardown";
import {
  assertMainnetConnection,
  createMainnetConnection,
  fetchWithBackoff,
  waitForCommitment,
  waitForFinalized,
} from "../rpc";
import type {
  DemoExpectedMoneyState,
  DemoMoveRequestBody,
  DemoPolicyBundle,
  SponsorPrefundRequestBody,
  SponsorPolicyReference,
  SponsorRequestBody,
  SponsorSetupRequestBody,
  SponsorStage,
} from "../sponsor-protocol";
import {
  assertSignedTransactionMatchesExpected,
  badRequest,
  parsePublicKey,
  parseSponsorKey,
  SponsorRequestError,
} from "../sponsor-validation";
import {
  assertCreatedSettingsBoundary,
  findExistingSmartAccount,
  prepareSmartAccountCreation,
} from "../smart-account";

const AUTODEPOSIT_AMOUNT_RAW = 2_000_000n;
const AUTODEPOSIT_NONCE = 0n;
// Must match policy-setup.ts: one 2 USDC pull per five-minute window.
const AUTODEPOSIT_PERIOD_SECONDS = 5n * 60n;
const AUTODEPOSIT_EXPIRY = 9_223_372_036_854_775_807n;
const KAMINO_DEPOSIT_AMOUNT_RAW = 2_000_000n;
const KAMINO_WITHDRAW_AMOUNT_RAW = 1_000_000n;
const WALLET_RETURN_AMOUNT_RAW = 1_000_000n;
const EXIT_DAILY_LIMIT_RAW = 10_000_000n;
const RATE_WINDOW_MS = 10 * 60 * 1_000;
const RATE_LIMIT = 32;
const CHALLENGE_TTL_MS = 5 * 60 * 1_000;
const SESSION_TTL_MS = 60 * 60 * 1_000;
const POLICY_SETUP_WALLET_SOL_FLOOR_LAMPORTS = 100_000_000;
const KAMINO_SETUP_MAX_SPONSOR_DEBIT_LAMPORTS = 30_000_000;
/** A fresh Kamino position needs three setup stages, and the vaults client
 *  prepares exactly one per call: the vault's user metadata, then the
 *  obligation, then the farm user state for the reserve's collateral farm.
 *  Kamino Main's USDC reserve does carry a collateral farm, so every new
 *  wallet reaches the third stage. The bound stays tight rather than open
 *  ended so a stage that never lands cannot drain the sponsor. */
const KAMINO_SETUP_MAX_STAGES = 3;
export const DEMO_SESSION_COOKIE = "loyal_privy_demo_session";

/** The sponsor's own RPC. When DEMO_SERVER_RPC_URL is mounted (a keyed
 *  endpoint that never reaches the browser), server-side re-derivation stops
 *  competing with browsers for the shared keyless endpoint's rate limit;
 *  without it the server falls back to the frozen keyless transport. */
let serverConnectionPromise: Promise<Connection> | null = null;

async function resolveServerConnection(): Promise<Connection> {
  const url = process.env.DEMO_SERVER_RPC_URL;
  if (!url) {
    console.log("[privy-showcase] sponsor uses the shared keyless RPC");
    return createMainnetConnection();
  }
  const dedicated = new Connection(assertMainnetRpcUrl(url), {
    commitment: "finalized",
    fetch: fetchWithBackoff,
  });
  try {
    await assertMainnetConnection(dedicated);
    console.log("[privy-showcase] sponsor uses the dedicated server RPC");
    return dedicated;
  } catch (error) {
    // A rejected key (403/401) or a wrong-cluster URL must degrade to the
    // keyless transport, not break every sponsor request. Never log the URL
    // itself; it may embed an API key.
    console.error(
      "[privy-showcase] dedicated server RPC rejected; falling back to the shared keyless RPC",
      { message: error instanceof Error ? error.message : String(error) }
    );
    return createMainnetConnection();
  }
}

/** The sponsor's RPC, probed once per process: the dedicated keyed endpoint
 *  when DEMO_SERVER_RPC_URL is mounted and answers as mainnet, otherwise the
 *  frozen keyless transport. */
export function getServerConnection(): Promise<Connection> {
  serverConnectionPromise ??= resolveServerConnection();
  return serverConnectionPromise;
}

const SETUP_MAX_SPONSOR_DEBIT_LAMPORTS: Record<SponsorStage, number> = {
  settings: 15_000_000,
  "autodeposit-authority": 10_000_000,
  "autodeposit-policy": 25_000_000,
  "autodeposit-delegation": 15_000_000,
  "autodeposit-approval": 2_000_000,
  "earn-route-policy": 25_000_000,
  "earn-setup-policy": 60_000_000,
  "exit-policy": 25_000_000,
  // Teardown stages are sponsor-paid so the sponsor can be the rent
  // collector the program requires. They usually run a net credit (rents
  // come back), which the debit bound below allows.
  "teardown-withdraw": 2_000_000,
  "teardown-cleanup": 2_000_000,
  "teardown-autodeposit": 2_000_000,
  "teardown-exit": 2_000_000,
  "teardown-refund": 2_000_000,
};

type RateEntry = { count: number; resetAt: number };
const CHALLENGE_AUDIENCE = "loyal-privy-demo/challenge";
const SESSION_AUDIENCE = "loyal-privy-demo/session";
const TOKEN_ISSUER = "loyal-privy-demo";
const rateEntries = new Map<string, RateEntry>();
const inFlightAccountCreations = new Set<string>();
const inFlightMoves = new Set<string>();
const inFlightPrefunds = new Set<string>();
const completedPrefunds = new Set<string>();
let jwks: JWTVerifyGetKey | null = null;

function parsePolicyReference(
  value: SponsorPolicyReference | undefined,
  label: string
): { account: PublicKey; seed: bigint } {
  if (!value || typeof value.account !== "string" || typeof value.seed !== "string") {
    badRequest(`${label} is required.`);
  }
  let seed: bigint;
  try {
    seed = BigInt(value.seed);
  } catch {
    badRequest(`${label} seed is invalid.`);
  }
  if (seed < 0n || seed > BigInt(Number.MAX_SAFE_INTEGER)) {
    badRequest(`${label} seed is out of range.`);
  }
  return { account: parsePublicKey(value.account, `${label} account`), seed };
}

function parseNonnegativeRaw(value: string, label: string): bigint {
  if (!/^\d+$/.test(value)) badRequest(`${label} is invalid.`);
  return BigInt(value);
}

function parseExpectedState(value: DemoExpectedMoneyState): Omit<DemoMoneyState, "vault"> {
  return {
    walletUsdcRaw: parseNonnegativeRaw(value.walletUsdcRaw, "Expected wallet balance"),
    smartAccountUsdcRaw: parseNonnegativeRaw(
      value.smartAccountUsdcRaw,
      "Expected smart-account balance"
    ),
    kaminoUsdcRaw: parseNonnegativeRaw(value.kaminoUsdcRaw, "Expected Kamino balance"),
  };
}

export function getSponsorKeypair(): Keypair {
  return parseSponsorKey(process.env.SMART_ACCOUNT_SPONSOR_PK);
}

export function getPolicySignerKeypair(): Keypair {
  const keypair = parseSponsorKey(
    process.env.EARN_POLICY_SPONSOR_PK,
    "EARN_POLICY_SPONSOR_PK"
  );
  const configured = process.env.SMART_ACCOUNT_SPONSOR_PUBKEY;
  if (!configured) throw new Error("SMART_ACCOUNT_SPONSOR_PUBKEY is not configured.");
  let publicKey: PublicKey;
  try {
    publicKey = new PublicKey(configured);
  } catch {
    throw new Error("SMART_ACCOUNT_SPONSOR_PUBKEY is invalid.");
  }
  if (!keypair.publicKey.equals(publicKey)) {
    throw new Error("SMART_ACCOUNT_SPONSOR_PUBKEY does not match EARN_POLICY_SPONSOR_PK.");
  }
  return keypair;
}

function getJwks(appId: string): JWTVerifyGetKey {
  jwks ??= createRemoteJWKSet(new URL(`https://api.privy.io/v1/apps/${appId}/jwks.json`));
  return jwks;
}

async function verifyPrivyAccessUser(args: {
  accessToken: string | null;
}): Promise<string> {
  const appId = process.env.NEXT_PUBLIC_PRIVY_APP_ID;
  if (!appId) throw new Error("NEXT_PUBLIC_PRIVY_APP_ID is not configured.");
  if (!args.accessToken || args.accessToken.length > 16_384) {
    throw new SponsorRequestError(401, "A Privy access token is required.");
  }
  try {
    const verified = await verifyAccessToken({
      access_token: args.accessToken,
      app_id: appId,
      verification_key: getJwks(appId),
    });
    return verified.user_id;
  } catch {
    throw new SponsorRequestError(401, "The Privy access token is invalid.");
  }
}

/** Challenges and sessions used to live in module-scope Maps. Each Lambda
 *  instance had its own, so a session minted on one instance was invisible to
 *  the next request and every sponsor call failed with a 401. Both tokens are
 *  now self-contained JWTs: any instance can verify one without shared state. */
let sessionKeyCache: Uint8Array | null = null;

function getSessionKey(): Uint8Array {
  if (sessionKeyCache) return sessionKeyCache;
  const material =
    process.env.DEMO_SESSION_SECRET ?? process.env.EARN_POLICY_SPONSOR_PK;
  if (!material) {
    throw new Error(
      "DEMO_SESSION_SECRET or EARN_POLICY_SPONSOR_PK must be configured to sign demo sessions."
    );
  }
  sessionKeyCache = new Uint8Array(
    createHash("sha256")
      .update(`loyal-privy-demo/session-key/v1\n${material}`)
      .digest()
  );
  return sessionKeyCache;
}

function challengeMessage(args: {
  expiresAt: number;
  nonce: string;
  origin: string;
  wallet: string;
}): string {
  return [
    "Authorize the Loyal Privy demo",
    `Origin: ${args.origin}`,
    `Wallet: ${args.wallet}`,
    `Challenge: ${args.nonce}`,
    `Expires: ${new Date(args.expiresAt).toISOString()}`,
  ].join("\n");
}

async function signAuthToken(args: {
  audience: string;
  claims: Record<string, string | number>;
  expiresAt: number;
  userId: string;
}): Promise<string> {
  return await new SignJWT(args.claims)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuer(TOKEN_ISSUER)
    .setAudience(args.audience)
    .setSubject(args.userId)
    .setIssuedAt()
    .setExpirationTime(Math.floor(args.expiresAt / 1_000))
    .sign(getSessionKey());
}

async function readAuthToken(args: {
  audience: string;
  token: string;
}): Promise<Record<string, unknown> & { sub?: string }> {
  const { payload } = await jwtVerify(args.token, getSessionKey(), {
    algorithms: ["HS256"],
    audience: args.audience,
    issuer: TOKEN_ISSUER,
  });
  return payload;
}

export async function createWalletChallenge(args: {
  accessToken: string | null;
  origin: string;
  wallet: PublicKey;
}): Promise<{ challengeId: string; message: string }> {
  const userId = await verifyPrivyAccessUser({ accessToken: args.accessToken });
  const nonce = randomBytes(18).toString("base64url");
  const expiresAt = Date.now() + CHALLENGE_TTL_MS;
  const wallet = args.wallet.toBase58();
  const message = challengeMessage({
    expiresAt,
    nonce,
    origin: args.origin,
    wallet,
  });
  const challengeId = await signAuthToken({
    audience: CHALLENGE_AUDIENCE,
    claims: { expiresAt, nonce, origin: args.origin, wallet },
    expiresAt,
    userId,
  });
  return { challengeId, message };
}

export async function verifyWalletChallenge(args: {
  accessToken: string | null;
  challengeId: string;
  signature: string;
  wallet: PublicKey;
}): Promise<{ expiresAt: number; sessionToken: string; userId: string }> {
  const userId = await verifyPrivyAccessUser({ accessToken: args.accessToken });
  let claims: Record<string, unknown> & { sub?: string };
  try {
    claims = await readAuthToken({
      audience: CHALLENGE_AUDIENCE,
      token: args.challengeId,
    });
  } catch {
    throw new SponsorRequestError(401, "The wallet challenge is invalid or expired.");
  }
  const expiresAt = typeof claims.expiresAt === "number" ? claims.expiresAt : 0;
  if (
    claims.sub !== userId ||
    claims.wallet !== args.wallet.toBase58() ||
    typeof claims.nonce !== "string" ||
    typeof claims.origin !== "string" ||
    expiresAt <= Date.now()
  ) {
    throw new SponsorRequestError(401, "The wallet challenge is invalid or expired.");
  }
  const challenge = {
    message: challengeMessage({
      expiresAt,
      nonce: claims.nonce,
      origin: claims.origin,
      wallet: args.wallet.toBase58(),
    }),
  };
  if (!/^[A-Za-z0-9+/]{86}==$/.test(args.signature)) {
    throw new SponsorRequestError(400, "The wallet challenge signature is invalid.");
  }
  const signature = Buffer.from(args.signature, "base64");
  if (
    signature.length !== 64 ||
    !nacl.sign.detached.verify(
      new TextEncoder().encode(challenge.message),
      signature,
      args.wallet.toBytes()
    )
  ) {
    throw new SponsorRequestError(401, "The wallet challenge signature is invalid.");
  }
  const sessionExpiresAt = Date.now() + SESSION_TTL_MS;
  const sessionToken = await signAuthToken({
    audience: SESSION_AUDIENCE,
    claims: { wallet: args.wallet.toBase58() },
    expiresAt: sessionExpiresAt,
    userId,
  });
  return { expiresAt: sessionExpiresAt, sessionToken, userId };
}

export async function authenticatePrivyWallet(args: {
  cookieHeader: string | null;
  wallet: PublicKey;
}): Promise<string> {
  const sessionToken = args.cookieHeader
    ?.split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${DEMO_SESSION_COOKIE}=`))
    ?.slice(DEMO_SESSION_COOKIE.length + 1);
  let claims: (Record<string, unknown> & { sub?: string }) | null = null;
  if (sessionToken) {
    try {
      claims = await readAuthToken({
        audience: SESSION_AUDIENCE,
        token: sessionToken,
      });
    } catch {
      claims = null;
    }
  }
  if (!claims || !claims.sub || claims.wallet !== args.wallet.toBase58()) {
    throw new SponsorRequestError(
      401,
      "Authorize this Privy wallet for the demo before requesting sponsorship."
    );
  }
  return claims.sub;
}

export function enforceSameOrigin(request: Request): void {
  const origin = request.headers.get("origin");
  if (!origin || origin !== new URL(request.url).origin) {
    throw new SponsorRequestError(403, "Cross-origin sponsorship is not allowed.");
  }
}

export function enforceRateLimit(key: string, now = Date.now()): void {
  const current = rateEntries.get(key);
  if (!current || current.resetAt <= now) {
    rateEntries.set(key, { count: 1, resetAt: now + RATE_WINDOW_MS });
    return;
  }
  if (current.count >= RATE_LIMIT) {
    throw new SponsorRequestError(429, "Too many demo requests. Try again later.");
  }
  current.count += 1;
}

function assertSettings(
  settings: Awaited<ReturnType<typeof accounts.Settings.fromAccountAddress>>,
  wallet: PublicKey
): void {
  assertCreatedSettingsBoundary({
    wallet,
    threshold: settings.threshold,
    timeLock: settings.timeLock,
    signers: settings.signers.map((signer) => ({
      key: signer.key,
      permissionMask: signer.permissions.mask,
    })),
  });
}

async function expectedSetupOperation(args: {
  body: SponsorSetupRequestBody;
  connection: Connection;
  policySigner: PublicKey;
  sponsor: PublicKey;
  wallet: PublicKey;
  settings: PublicKey;
}): Promise<PreparedLoyalSmartAccountsOperation<string>> {
  if (args.body.stage === "settings") {
    const existing = await args.connection.getAccountInfo(args.settings, "finalized");
    if (existing) badRequest("The smart account already exists.");
    const creation = await prepareSmartAccountCreation({
      connection: args.connection,
      sponsor: args.sponsor,
      wallet: args.wallet,
    });
    if (!creation.settings.equals(args.settings)) {
      badRequest("Settings address does not match the current creation slot.");
    }
    return creation.prepared;
  }

  const settingsAccount = await accounts.Settings.fromAccountAddress(
    args.connection,
    args.settings,
    "finalized"
  );
  assertSettings(settingsAccount, args.wallet);
  const client = createSmartAccountVaultsClient({
    connection: args.connection,
    programId: SQUADS_PROGRAM_ID,
  });

  if (args.body.stage.startsWith("teardown-")) {
    for (let attempt = 0; ; attempt++) {
      try {
        return await prepareTeardownStage(args.body.stage as TeardownStage, {
          connection: args.connection,
          policySigner: args.policySigner,
          settings: args.settings,
          sponsor: args.sponsor,
          wallet: args.wallet,
        });
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Teardown stage is unavailable.";
        // The package's internal simulations can race a just-expired
        // blockhash; one clean retry resolves it.
        if (attempt === 0 && message.includes("Blockhash not found")) continue;
        badRequest(message);
      }
    }
  }

  if (args.body.stage.startsWith("autodeposit-")) {
    if (!args.body.autodepositPolicySeed) {
      badRequest("Autodeposit policy seed is required.");
    }
    const setup = await client.prepareEarnUsdcAutodepositSetup({
      amountRaw: AUTODEPOSIT_AMOUNT_RAW,
      cluster: DEMO_CLUSTER,
      expiryTimestamp: AUTODEPOSIT_EXPIRY,
      feePayer: args.wallet,
      nonce: AUTODEPOSIT_NONCE,
      periodLengthSeconds: AUTODEPOSIT_PERIOD_SECONDS,
      policySeed: BigInt(args.body.autodepositPolicySeed),
      policySigner: args.policySigner,
      settingsPda: args.settings,
      signer: args.wallet,
      startTimestamp: 0n,
      walletAddress: args.wallet,
    });
    const expectedStage: Record<typeof setup.stage, SponsorStage> = {
      initialize_subscription_authority: "autodeposit-authority",
      create_policy: "autodeposit-policy",
      create_recurring_delegation: "autodeposit-delegation",
      approve_token_delegate: "autodeposit-approval",
    };
    if (expectedStage[setup.stage] !== args.body.stage) {
      badRequest(`Expected ${expectedStage[setup.stage]} before this setup stage.`);
    }
    return setup.prepared;
  }

  if (
    args.body.stage === "earn-route-policy" ||
    args.body.stage === "earn-setup-policy"
  ) {
    const policyState = await client.prepareEarnUsdcYieldRoutingPolicyState({
      cluster: DEMO_CLUSTER,
      feePayer: args.sponsor,
      memo: "Privy Loyal demo: Main market policy setup",
      policyScope: "kamino_main_usdc",
      settingsPda: args.settings,
      signer: args.policySigner,
      walletAddress: args.wallet,
    });
    const prepared =
      args.body.stage === "earn-route-policy"
        ? policyState.policySetupPrepared
        : policyState.policyFinalizePrepared;
    if (!prepared) badRequest("The requested Main-market policy already exists.");
    return prepared;
  }

  const prepared = await client.prepareSetSpendingLimitPolicy({
    accountIndex: EARN_VAULT_INDEX,
    amount: EXIT_DAILY_LIMIT_RAW,
    creator: args.wallet,
    destinations: [args.wallet],
    feePayer: args.sponsor,
    memo: "Privy Loyal demo: return USDC only to originating wallet",
    mint: CANONICAL_USDC_MINT,
    period: "day",
    settingsPda: args.settings,
    signer: args.policySigner,
  });
  return prepared.prepared;
}

async function assertExactPolicySet(args: {
  bundle: DemoPolicyBundle;
  connection: Connection;
  settings: PublicKey;
  wallet: PublicKey;
  policySigner: PublicKey;
}): Promise<{
  autodeposit: { account: PublicKey; seed: bigint; recurringDelegation: PublicKey; nonce: bigint };
  earnRoute: { account: PublicKey; seed: bigint };
  earnSetup: { account: PublicKey; seed: bigint };
  exit: { account: PublicKey; seed: bigint };
}> {
  const autodepositRef = parsePolicyReference(args.bundle.autodeposit, "Autodeposit policy");
  const earnRoute = parsePolicyReference(args.bundle.earnRoute, "Earn route policy");
  const earnSetup = parsePolicyReference(args.bundle.earnSetup, "Earn setup policy");
  const exit = parsePolicyReference(args.bundle.exit, "Exit policy");
  const recurringDelegation = parsePublicKey(
    args.bundle.autodeposit.recurringDelegation,
    "Recurring delegation"
  );
  const nonce = parseNonnegativeRaw(args.bundle.autodeposit.nonce, "Delegation nonce");
  if (nonce !== AUTODEPOSIT_NONCE) badRequest("Delegation nonce is not the fixed demo nonce.");

  const expectedAddresses = [
    autodepositRef.account,
    earnRoute.account,
    earnSetup.account,
    exit.account,
  ];
  if (new Set(expectedAddresses.map((key) => key.toBase58())).size !== 4) {
    badRequest("The four policy references must be distinct.");
  }
  const rows = await args.connection.getProgramAccounts(SQUADS_PROGRAM_ID, {
    commitment: "finalized",
    filters: [
      { memcmp: { offset: 0, bytes: bs58.encode(Uint8Array.from(policyDiscriminator)) } },
      { memcmp: { offset: 8, bytes: args.settings.toBase58() } },
    ],
  });
  const actual = rows.map((row) => row.pubkey.toBase58()).sort();
  const expected = expectedAddresses.map((key) => key.toBase58()).sort();
  if (actual.length !== 4 || actual.join(",") !== expected.join(",")) {
    badRequest("Settings must contain exactly the four expected demo policies.");
  }

  const client = createSmartAccountVaultsClient({
    connection: args.connection,
    programId: SQUADS_PROGRAM_ID,
  });
  await client.assertEarnUsdcAutodepositCanonicalArtifacts({
    amountRaw: AUTODEPOSIT_AMOUNT_RAW,
    cluster: DEMO_CLUSTER,
    nonce,
    policy: autodepositRef.account,
    policySeed: autodepositRef.seed,
    policySigner: args.policySigner,
    recurringDelegation,
    settingsPda: args.settings,
    walletAddress: args.wallet,
  });

  const exitPolicy = await client.sdk.policies.queries.fetchPolicy(exit.account);
  const exitState = exitPolicy.policyState;
  const exitSigner = exitPolicy.signers[0];
  if (
    !exitPolicy.settings.equals(args.settings) ||
    exitPolicy.threshold !== 1 ||
    exitPolicy.timeLock !== 0 ||
    exitPolicy.signers.length !== 1 ||
    !exitSigner?.key.equals(args.policySigner) ||
    exitState.__kind !== "SpendingLimit"
  ) {
    badRequest("Exit policy authority is not canonical.");
  }
  const exitRule = exitState.fields[0];
  if (
    exitRule.sourceAccountIndex !== EARN_VAULT_INDEX ||
    exitRule.destinations.length !== 1 ||
    !exitRule.destinations[0]?.equals(args.wallet) ||
    !exitRule.spendingLimit.mint.equals(CANONICAL_USDC_MINT) ||
    toBigInt(exitRule.spendingLimit.quantityConstraints.maxPerPeriod) !==
      EXIT_DAILY_LIMIT_RAW ||
    exitRule.spendingLimit.timeConstraints.period.__kind !== "Daily"
  ) {
    badRequest("Exit policy does not match the fixed USDC-to-wallet limit.");
  }

  return {
    autodeposit: {
      ...autodepositRef,
      recurringDelegation,
      nonce,
    },
    earnRoute,
    earnSetup,
    exit,
  };
}

async function expectedMoveOperation(args: {
  body: DemoMoveRequestBody;
  connection: Connection;
  policySigner: PublicKey;
  sponsor: PublicKey;
  wallet: PublicKey;
  settings: PublicKey;
}): Promise<{
  prepared: PreparedLoyalSmartAccountsOperation<string>;
  setupPrepared?: PreparedLoyalSmartAccountsOperation<string> | null;
}> {
  const policies = await assertExactPolicySet({
    bundle: args.body.policies,
    connection: args.connection,
    policySigner: args.policySigner,
    settings: args.settings,
    wallet: args.wallet,
  });
  const client = createSmartAccountVaultsClient({
    connection: args.connection,
    programId: SQUADS_PROGRAM_ID,
  });
  switch (args.body.action) {
    case "wallet_to_smart_account":
      return { prepared: (
        await client.prepareEarnUsdcAutodepositPull({
          amountRaw: AUTODEPOSIT_AMOUNT_RAW,
          cluster: DEMO_CLUSTER,
          feePayer: args.sponsor,
          memo: "Privy Loyal demo: wallet to smart account",
          policy: policies.autodeposit.account,
          policySigner: args.policySigner,
          recurringDelegation: policies.autodeposit.recurringDelegation,
          walletAddress: args.wallet,
        })
      ).prepared };
    case "smart_account_to_kamino":
      {
        const deposit = await client.prepareEarnUsdcKaminoDeposit({
          amountRaw: KAMINO_DEPOSIT_AMOUNT_RAW,
          cluster: DEMO_CLUSTER,
          feePayer: args.sponsor,
          memo: "Privy Loyal demo: smart account to Kamino Main",
          policy: policies.earnRoute.account,
          setupPolicy: policies.earnSetup.account,
          policySigner: args.policySigner,
          settingsPda: args.settings,
        });
        return {
          prepared: deposit.prepared,
          setupPrepared: deposit.setupPrepared,
        };
      }
    case "kamino_to_smart_account":
      return { prepared: (
        await client.prepareEarnUsdcKaminoWithdraw({
          amountRaw: KAMINO_WITHDRAW_AMOUNT_RAW,
          cluster: DEMO_CLUSTER,
          feePayer: args.sponsor,
          memo: "Privy Loyal demo: Kamino Main to smart account",
          policy: policies.earnRoute.account,
          policySigner: args.policySigner,
          settingsPda: args.settings,
        })
      ).prepared };
    case "smart_account_to_wallet":
      return { prepared: await client.prepareUseTokenSpendingLimitPolicy({
        amountRaw: WALLET_RETURN_AMOUNT_RAW,
        decimals: 6,
        destination: args.wallet,
        feePayer: args.sponsor,
        memo: "Privy Loyal demo: smart account to originating wallet",
        mint: CANONICAL_USDC_MINT,
        settingsPda: args.settings,
        signer: args.policySigner,
        spendingLimitPolicy: policies.exit.account,
      }) };
  }
}

async function simulateAndBoundSponsorDebit(args: {
  connection: Connection;
  sponsor: PublicKey;
  /** Teardown refunds policy rent to the sponsor, so its net lamport change
   *  is a credit rather than a debit. Only such stages may go negative. */
  allowCredit?: boolean;
  maxDebitLamports: number;
  transaction: VersionedTransaction;
}): Promise<void> {
  const before = await args.connection.getBalance(args.sponsor, "confirmed");
  const simulation = await args.connection.simulateTransaction(args.transaction, {
    commitment: "confirmed",
    sigVerify: true,
    replaceRecentBlockhash: false,
    accounts: { encoding: "base64", addresses: [args.sponsor.toBase58()] },
  });
  if (simulation.value.err) {
    const logTail = (simulation.value.logs ?? []).slice(-14).join(" | ");
    badRequest(
      `Transaction simulation failed: ${JSON.stringify(simulation.value.err)}${
        logTail ? ` · ${logTail}` : ""
      }`
    );
  }
  const after = simulation.value.accounts?.[0]?.lamports;
  if (typeof after !== "number") badRequest("Simulation did not return sponsor state.");
  const debit = before - after;
  if ((!args.allowCredit && debit < 0) || debit > args.maxDebitLamports) {
    badRequest("Simulated sponsor debit exceeds the fixed stage cap.");
  }
}

async function submitExactlyOnce(args: {
  connection: Connection;
  finality?: "confirmed" | "finalized";
  transaction: VersionedTransaction;
}): Promise<string> {
  const signatureBytes = args.transaction.signatures[0];
  if (!signatureBytes) throw new Error("Fee-payer signature was not produced.");
  const expectedSignature = bs58.encode(signatureBytes);
  const existing = await args.connection.getSignatureStatuses([expectedSignature], {
    searchTransactionHistory: true,
  });
  if (!existing.value[0]) {
    let sent: string;
    try {
      sent = await args.connection.sendRawTransaction(args.transaction.serialize(), {
        maxRetries: 2,
        // The browser compiles user-signed stages against a confirmed
        // blockhash; preflight must simulate at the same commitment, or a
        // young blockhash is "not found" in the finalized bank and the
        // submit fails on timing alone.
        preflightCommitment: "confirmed",
        skipPreflight: false,
      });
    } catch (error) {
      const status = await args.connection.getSignatureStatuses([expectedSignature], {
        searchTransactionHistory: true,
      });
      if (!status.value[0]) {
        if (
          error instanceof Error &&
          error.message.includes("Blockhash not found")
        ) {
          throw new SponsorRequestError(
            400,
            "The signed transaction expired before it reached the chain. Approve the step again."
          );
        }
        throw error;
      }
      sent = expectedSignature;
    }
    if (sent !== expectedSignature) throw new Error("RPC returned an unexpected signature.");
  }
  try {
    await waitForCommitment(
      args.connection,
      expectedSignature,
      args.finality ?? "finalized"
    );
  } catch {
    throw new SponsorRequestError(
      502,
      "Transaction was submitted but finalization is unresolved.",
      expectedSignature
    );
  }
  return expectedSignature;
}

function assertExpectedMoneyState(
  actual: DemoMoneyState,
  expected: Omit<DemoMoneyState, "vault">
): void {
  if (
    actual.walletUsdcRaw !== expected.walletUsdcRaw ||
    actual.smartAccountUsdcRaw !== expected.smartAccountUsdcRaw ||
    actual.kaminoUsdcRaw !== expected.kaminoUsdcRaw
  ) {
    throw new SponsorRequestError(409, "Money state changed. Refresh balances and try again.");
  }
}

function reconcileMove(
  action: DemoMoveRequestBody["action"],
  before: DemoMoneyState,
  after: DemoMoneyState
): void {
  const smartAccountDelta = after.smartAccountUsdcRaw - before.smartAccountUsdcRaw;
  const ok =
    action === "wallet_to_smart_account"
      ? before.walletUsdcRaw - after.walletUsdcRaw === AUTODEPOSIT_AMOUNT_RAW &&
        after.smartAccountUsdcRaw - before.smartAccountUsdcRaw === AUTODEPOSIT_AMOUNT_RAW
      : action === "smart_account_to_kamino"
      ? before.smartAccountUsdcRaw - after.smartAccountUsdcRaw === KAMINO_DEPOSIT_AMOUNT_RAW &&
        after.kaminoUsdcRaw > before.kaminoUsdcRaw
      : action === "kamino_to_smart_account"
      ? smartAccountDelta >= KAMINO_WITHDRAW_AMOUNT_RAW &&
        smartAccountDelta <= KAMINO_WITHDRAW_AMOUNT_RAW + 2n &&
        after.kaminoUsdcRaw < before.kaminoUsdcRaw
      : before.smartAccountUsdcRaw - after.smartAccountUsdcRaw ===
          WALLET_RETURN_AMOUNT_RAW &&
        after.walletUsdcRaw - before.walletUsdcRaw === WALLET_RETURN_AMOUNT_RAW;
  if (!ok) throw new Error("Finalized balances do not match the fixed money movement.");
}

export async function sponsorSetupTransaction(args: {
  body: SponsorSetupRequestBody;
  connection: Connection;
  policySigner: PublicKey;
  sponsor: Keypair;
  wallet: PublicKey;
}): Promise<string> {
  const creationLockKey =
    args.body.stage === "settings" ? args.wallet.toBase58() : null;
  if (creationLockKey && inFlightAccountCreations.has(creationLockKey)) {
    throw new SponsorRequestError(
      409,
      "Smart-account creation is already in progress for this wallet."
    );
  }
  if (creationLockKey) inFlightAccountCreations.add(creationLockKey);
  try {
  let serialized: Uint8Array;
  try {
    serialized = Buffer.from(args.body.transaction, "base64");
  } catch {
    badRequest("Transaction is not valid base64.");
  }
  if (serialized.length > 1_232) badRequest("Serialized transaction exceeds the Solana packet limit.");
  let transaction: VersionedTransaction;
  try {
    transaction = VersionedTransaction.deserialize(serialized);
  } catch {
    badRequest("Transaction payload cannot be decoded.");
  }
  const settings = parsePublicKey(args.body.settings, "Settings");
  await assertMainnetConnection(args.connection);
  if (args.body.stage === "settings") {
    const existing = await findExistingSmartAccount({
      connection: args.connection,
      wallet: args.wallet,
    });
    if (existing) {
      throw new SponsorRequestError(
        409,
        `This wallet already has smart account ${existing.settings.toBase58()}. Reload instead of creating another.`
      );
    }
  }
  const expected = await expectedSetupOperation({
    body: args.body,
    connection: args.connection,
    policySigner: args.policySigner,
    sponsor: args.sponsor.publicKey,
    wallet: args.wallet,
    settings,
  });
  assertSignedTransactionMatchesExpected({
    transaction,
    expected,
    sponsor: args.sponsor.publicKey,
    wallet: args.wallet,
  });
  const blockhashValid = await args.connection.isBlockhashValid(
    transaction.message.recentBlockhash,
    { commitment: "confirmed" }
  );
  if (!blockhashValid.value) badRequest("Transaction blockhash is stale.");
  const requiredSignerKeys = transaction.message.staticAccountKeys.slice(
    0,
    transaction.message.header.numRequiredSignatures
  );
  if (requiredSignerKeys.some((key) => key.equals(args.sponsor.publicKey))) {
    transaction.sign([args.sponsor]);
  }
  await simulateAndBoundSponsorDebit({
    allowCredit: args.body.stage.startsWith("teardown-"),
    connection: args.connection,
    maxDebitLamports: SETUP_MAX_SPONSOR_DEBIT_LAMPORTS[args.body.stage],
    sponsor: args.sponsor.publicKey,
    transaction,
  });
  const signature = await submitExactlyOnce({
    connection: args.connection,
    // Teardown stages are mutually independent, so waiting for the confirmed
    // commitment is enough; nothing downstream re-reads their effects before
    // the next user action.
    finality: args.body.stage.startsWith("teardown-") ? "confirmed" : "finalized",
    transaction,
  });
  if (args.body.stage === "settings") {
    const created = await accounts.Settings.fromAccountAddress(
      args.connection,
      settings,
      "finalized"
    );
    assertSettings(created, args.wallet);
  }
  return signature;
  } finally {
    if (creationLockKey) inFlightAccountCreations.delete(creationLockKey);
  }
}

export async function prefundPolicySetup(args: {
  body: SponsorPrefundRequestBody;
  connection: Connection;
  sponsor: Keypair;
  wallet: PublicKey;
}): Promise<{ signature?: string }> {
  const settings = parsePublicKey(args.body.settings, "Settings");
  const lockKey = settings.toBase58();
  if (inFlightPrefunds.has(lockKey)) {
    throw new SponsorRequestError(409, "Policy setup funding is already in progress.");
  }
  inFlightPrefunds.add(lockKey);
  try {
    await assertMainnetConnection(args.connection);
    const settingsAccount = await accounts.Settings.fromAccountAddress(
      args.connection,
      settings,
      "finalized"
    );
    assertSettings(settingsAccount, args.wallet);
    const balance = await args.connection.getBalance(args.wallet, "finalized");
    const existingPolicies = await args.connection.getProgramAccounts(
      SQUADS_PROGRAM_ID,
      {
        commitment: "finalized",
        filters: [
          {
            memcmp: {
              offset: 0,
              bytes: bs58.encode(Uint8Array.from(policyDiscriminator)),
            },
          },
          { memcmp: { offset: 8, bytes: settings.toBase58() } },
        ],
      }
    );
    if (existingPolicies.length > 0 || completedPrefunds.has(lockKey)) {
      completedPrefunds.add(lockKey);
      return {};
    }
    if (balance >= POLICY_SETUP_WALLET_SOL_FLOOR_LAMPORTS) {
      completedPrefunds.add(lockKey);
      return {};
    }
    const latest = await args.connection.getLatestBlockhash("finalized");
    const prepared: PreparedLoyalSmartAccountsOperation<string> = {
      operation: "privyDemoPolicySetupPrefund",
      payer: args.sponsor.publicKey,
      programId: SystemProgram.programId,
      requiresConfirmation: true,
      instructions: [
        SystemProgram.transfer({
          fromPubkey: args.sponsor.publicKey,
          lamports: POLICY_SETUP_WALLET_SOL_FLOOR_LAMPORTS - balance,
          toPubkey: args.wallet,
        }),
      ],
      lookupTableAccounts: [],
    };
    const transaction = compilePreparedOperation({
      blockhash: latest.blockhash,
      prepared,
    });
    transaction.sign([args.sponsor]);
    await simulateAndBoundSponsorDebit({
      connection: args.connection,
      maxDebitLamports: POLICY_SETUP_WALLET_SOL_FLOOR_LAMPORTS + 10_000,
      sponsor: args.sponsor.publicKey,
      transaction,
    });
    const signature = await submitExactlyOnce({
      connection: args.connection,
      transaction,
    });
    const fundedBalance = await args.connection.getBalance(args.wallet, "finalized");
    if (fundedBalance < POLICY_SETUP_WALLET_SOL_FLOOR_LAMPORTS) {
      throw new Error("Finalized policy setup funding did not reach its fixed floor.");
    }
    completedPrefunds.add(lockKey);
    return { signature };
  } finally {
    inFlightPrefunds.delete(lockKey);
  }
}

export async function executeDemoMove(args: {
  body: DemoMoveRequestBody;
  connection: Connection;
  policySigner: Keypair;
  sponsor: Keypair;
  wallet: PublicKey;
}): Promise<{ signature: string; supportingSignatures: string[] }> {
  const settings = parsePublicKey(args.body.settings, "Settings");
  const lockKey = `${args.wallet.toBase58()}:${args.body.action}`;
  if (inFlightMoves.has(lockKey)) {
    throw new SponsorRequestError(409, "This money movement is already in progress.");
  }
  inFlightMoves.add(lockKey);
  try {
    await assertMainnetConnection(args.connection);
    const before = await readDemoMoneyState({
      connection: args.connection,
      settings,
      wallet: args.wallet,
    });
    assertExpectedMoneyState(before, parseExpectedState(args.body.expected));
    let move = await expectedMoveOperation({
      body: args.body,
      connection: args.connection,
      policySigner: args.policySigner.publicKey,
      sponsor: args.sponsor.publicKey,
      wallet: args.wallet,
      settings,
    });
    const supportingSignatures: string[] = [];
    for (
      let setupAttempt = 0;
      move.setupPrepared && setupAttempt < KAMINO_SETUP_MAX_STAGES;
      setupAttempt += 1
    ) {
      const setupLatest = await args.connection.getLatestBlockhash("finalized");
      const setupTransaction = compilePreparedOperation({
        blockhash: setupLatest.blockhash,
        prepared: move.setupPrepared,
      });
      setupTransaction.sign([args.sponsor, args.policySigner]);
      await simulateAndBoundSponsorDebit({
        connection: args.connection,
        // A fresh Kamino obligation currently needs about 0.0242 SOL of
        // rent. Keep a small bounded margin for fees without granting this
        // endpoint an open-ended sponsor debit.
        maxDebitLamports: KAMINO_SETUP_MAX_SPONSOR_DEBIT_LAMPORTS,
        sponsor: args.sponsor.publicKey,
        transaction: setupTransaction,
      });
      supportingSignatures.push(
        await submitExactlyOnce({
          connection: args.connection,
          transaction: setupTransaction,
        })
      );
      move = await expectedMoveOperation({
        body: args.body,
        connection: args.connection,
        policySigner: args.policySigner.publicKey,
        sponsor: args.sponsor.publicKey,
        wallet: args.wallet,
        settings,
      });
    }
    if (move.setupPrepared) {
      throw new Error(
        `Kamino setup did not converge after ${KAMINO_SETUP_MAX_STAGES} finalized stages.`
      );
    }
    const latest = await args.connection.getLatestBlockhash("finalized");
    const transaction = compilePreparedOperation({
      blockhash: latest.blockhash,
      prepared: move.prepared,
    });
    transaction.sign([args.sponsor, args.policySigner]);
    await simulateAndBoundSponsorDebit({
      connection: args.connection,
      maxDebitLamports: 20_000_000,
      sponsor: args.sponsor.publicKey,
      transaction,
    });
    const signature = await submitExactlyOnce({ connection: args.connection, transaction });
    const after = await readDemoMoneyState({
      connection: args.connection,
      settings,
      wallet: args.wallet,
    });
    reconcileMove(args.body.action, before, after);
    return { signature, supportingSignatures };
  } finally {
    inFlightMoves.delete(lockKey);
  }
}

export async function handleSponsorRequest(args: {
  body: SponsorRequestBody;
  connection: Connection;
  policySigner: Keypair;
  sponsor: Keypair;
  wallet: PublicKey;
}): Promise<{ signature?: string; supportingSignatures?: string[] }> {
  if (args.body.kind === "prefund") {
    return prefundPolicySetup({ ...args, body: args.body });
  }
  if (args.body.kind === "setup") {
    return {
      signature: await sponsorSetupTransaction({
        ...args,
        body: args.body,
        policySigner: args.policySigner.publicKey,
      }),
    };
  }
  return executeDemoMove({ ...args, body: args.body });
}
