import "server-only";

import { randomBytes } from "node:crypto";
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
import { createRemoteJWKSet, type JWTVerifyGetKey } from "jose";
import nacl from "tweetnacl";
import {
  CANONICAL_USDC_MINT,
  DEMO_CLUSTER,
  EARN_VAULT_INDEX,
  SQUADS_PROGRAM_ID,
} from "../constants";
import { readDemoMoneyState, type DemoMoneyState } from "../money-state";
import { assertExpectedMoneyState, reconcileMove } from "../move-reconciliation";
import { assertMainnetConnection, waitForConfirmed } from "../rpc";
import {
  AUTODEPOSIT_AMOUNT_RAW,
  AUTODEPOSIT_EXPIRY,
  AUTODEPOSIT_NONCE,
  AUTODEPOSIT_PERIOD_SECONDS,
  AUTODEPOSIT_STAGE_BY_SDK_STAGE,
  type DemoExpectedMoneyState,
  type DemoMoveRequestBody,
  type DemoPolicyBundle,
  EXIT_DAILY_LIMIT_RAW,
  KAMINO_DEPOSIT_AMOUNT_RAW,
  KAMINO_WITHDRAW_AMOUNT_RAW,
  type SponsorPrefundRequestBody,
  type SponsorPolicyReference,
  type SponsorRequestBody,
  type SponsorSetupRequestBody,
  type SponsorStage,
  WALLET_RETURN_AMOUNT_RAW,
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

const RATE_WINDOW_MS = 10 * 60 * 1_000;
const RATE_LIMIT = 32;
const CHALLENGE_TTL_MS = 5 * 60 * 1_000;
const SESSION_TTL_MS = 60 * 60 * 1_000;
const POLICY_SETUP_WALLET_SOL_FLOOR_LAMPORTS = 100_000_000;
const KAMINO_SETUP_MAX_SPONSOR_DEBIT_LAMPORTS = 30_000_000;
export const DEMO_SESSION_COOKIE = "loyal_privy_demo_session";

const SETUP_MAX_SPONSOR_DEBIT_LAMPORTS: Record<SponsorStage, number> = {
  settings: 15_000_000,
  "autodeposit-authority": 10_000_000,
  "autodeposit-policy": 25_000_000,
  "autodeposit-delegation": 15_000_000,
  "autodeposit-approval": 2_000_000,
  "earn-route-policy": 25_000_000,
  "earn-setup-policy": 60_000_000,
  "exit-policy": 25_000_000,
};

type RateEntry = { count: number; resetAt: number };
type WalletChallenge = {
  expiresAt: number;
  message: string;
  userId: string;
  wallet: string;
};
type WalletSession = {
  expiresAt: number;
  userId: string;
  wallet: string;
};
const walletChallenges = new Map<string, WalletChallenge>();
const walletSessions = new Map<string, WalletSession>();
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

function pruneWalletAuth(now = Date.now()): void {
  for (const [id, value] of walletChallenges) {
    if (value.expiresAt <= now) walletChallenges.delete(id);
  }
  for (const [id, value] of walletSessions) {
    if (value.expiresAt <= now) walletSessions.delete(id);
  }
}

export async function createWalletChallenge(args: {
  accessToken: string | null;
  origin: string;
  wallet: PublicKey;
}): Promise<{ challengeId: string; message: string }> {
  const userId = await verifyPrivyAccessUser({ accessToken: args.accessToken });
  pruneWalletAuth();
  const challengeId = randomBytes(18).toString("base64url");
  const expiresAt = Date.now() + CHALLENGE_TTL_MS;
  const message = [
    "Authorize the Loyal Privy demo",
    `Origin: ${args.origin}`,
    `Wallet: ${args.wallet.toBase58()}`,
    `Challenge: ${challengeId}`,
    `Expires: ${new Date(expiresAt).toISOString()}`,
  ].join("\n");
  walletChallenges.set(challengeId, {
    expiresAt,
    message,
    userId,
    wallet: args.wallet.toBase58(),
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
  pruneWalletAuth();
  const challenge = walletChallenges.get(args.challengeId);
  walletChallenges.delete(args.challengeId);
  if (
    !challenge ||
    challenge.expiresAt <= Date.now() ||
    challenge.userId !== userId ||
    challenge.wallet !== args.wallet.toBase58()
  ) {
    throw new SponsorRequestError(401, "The wallet challenge is invalid or expired.");
  }
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
  const sessionToken = randomBytes(32).toString("base64url");
  const expiresAt = Date.now() + SESSION_TTL_MS;
  walletSessions.set(sessionToken, {
    expiresAt,
    userId,
    wallet: args.wallet.toBase58(),
  });
  return { expiresAt, sessionToken, userId };
}

export function authenticatePrivyWallet(args: {
  cookieHeader: string | null;
  wallet: PublicKey;
}): string {
  pruneWalletAuth();
  const sessionToken = args.cookieHeader
    ?.split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${DEMO_SESSION_COOKIE}=`))
    ?.slice(DEMO_SESSION_COOKIE.length + 1);
  const session = sessionToken ? walletSessions.get(sessionToken) : undefined;
  if (
    !session ||
    session.expiresAt <= Date.now() ||
    session.wallet !== args.wallet.toBase58()
  ) {
    throw new SponsorRequestError(
      401,
      "Authorize this Privy wallet for the demo before requesting sponsorship."
    );
  }
  return session.userId;
}

export function enforceSameOrigin(request: Request): void {
  const origin = request.headers.get("origin");
  if (!origin || origin !== new URL(request.url).origin) {
    throw new SponsorRequestError(403, "Cross-origin sponsorship is not allowed.");
  }
}

export function enforceRateLimit(key: string, now = Date.now()): void {
  for (const [entryKey, entry] of rateEntries) {
    if (entry.resetAt <= now) rateEntries.delete(entryKey);
  }
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
    const existing = await args.connection.getAccountInfo(args.settings, "confirmed");
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
    "confirmed"
  );
  assertSettings(settingsAccount, args.wallet);
  const client = createSmartAccountVaultsClient({
    connection: args.connection,
    programId: SQUADS_PROGRAM_ID,
  });

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
    const expectedStage = AUTODEPOSIT_STAGE_BY_SDK_STAGE[setup.stage];
    if (expectedStage !== args.body.stage) {
      badRequest(`Expected ${expectedStage} before this setup stage.`);
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
    commitment: "confirmed",
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
  if (debit < 0 || debit > args.maxDebitLamports) {
    badRequest("Simulated sponsor debit exceeds the fixed stage cap.");
  }
}

async function submitExactlyOnce(args: {
  connection: Connection;
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
        skipPreflight: false,
      });
    } catch (error) {
      const status = await args.connection.getSignatureStatuses([expectedSignature], {
        searchTransactionHistory: true,
      });
      if (!status.value[0]) throw error;
      sent = expectedSignature;
    }
    if (sent !== expectedSignature) throw new Error("RPC returned an unexpected signature.");
  }
  try {
    await waitForConfirmed(args.connection, expectedSignature);
  } catch {
    throw new SponsorRequestError(
      502,
      "Transaction was submitted but confirmation is unresolved.",
      expectedSignature
    );
  }
  return expectedSignature;
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
    connection: args.connection,
    maxDebitLamports: SETUP_MAX_SPONSOR_DEBIT_LAMPORTS[args.body.stage],
    sponsor: args.sponsor.publicKey,
    transaction,
  });
  const signature = await submitExactlyOnce({ connection: args.connection, transaction });
  if (args.body.stage === "settings") {
    const created = await accounts.Settings.fromAccountAddress(
      args.connection,
      settings,
      "confirmed"
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
      "confirmed"
    );
    assertSettings(settingsAccount, args.wallet);
    const balance = await args.connection.getBalance(args.wallet, "confirmed");
    const existingPolicies = await args.connection.getProgramAccounts(
      SQUADS_PROGRAM_ID,
      {
        commitment: "confirmed",
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
    const latest = await args.connection.getLatestBlockhash("confirmed");
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
    const fundedBalance = await args.connection.getBalance(args.wallet, "confirmed");
    if (fundedBalance < POLICY_SETUP_WALLET_SOL_FLOOR_LAMPORTS) {
      throw new Error("Confirmed policy setup funding did not reach its fixed floor.");
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
    for (let setupAttempt = 0; move.setupPrepared && setupAttempt < 2; setupAttempt += 1) {
      const setupLatest = await args.connection.getLatestBlockhash("confirmed");
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
      throw new Error("Kamino setup did not converge after two confirmed stages.");
    }
    const latest = await args.connection.getLatestBlockhash("confirmed");
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
    reconcileMove(args.body.action, before, after, signature);
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
