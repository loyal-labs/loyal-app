import bs58 from "bs58";
import nacl from "tweetnacl";
import {
  TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountIdempotentInstruction,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  VersionedTransaction,
} from "@solana/web3.js";
import {
  LoyalCluster,
  getKaminoUsdcEarnTargetForCluster,
} from "../packages/loyal-actions/src/index.ts";
import { sendPreparedWithWallet } from "../packages/smart-account-vaults/src/index.ts";
import { compilePreparedOperation } from "../packages/loyal-smart-accounts-core/src/index.ts";
import {
  PROGRAM_ADDRESS,
  pda,
} from "../packages/loyal-smart-accounts/src/index.ts";
import {
  buildEarnDepositConfirmRequestBody,
  buildEarnWithdrawalConfirmRequestBody,
} from "../frontend/src/lib/yield-optimization/earn-confirm-contracts.shared.ts";
import {
  hydratePreparedEarnUsdcDeposit,
  type EarnDepositPrepareResponse,
} from "../frontend/src/lib/yield-optimization/earn-deposit-prepare-contracts.shared.ts";
import {
  hydratePreparedEarnUsdcWithdraw,
  type EarnWithdrawPrepareResponse,
} from "../frontend/src/lib/yield-optimization/earn-withdraw-prepare-contracts.shared.ts";
import type {
  SmartAccountPreparedEarnUsdcDeposit,
  SmartAccountPreparedEarnUsdcWithdraw,
} from "../packages/smart-account-vaults/src/types.ts";
import {
  getSolanaEndpoints,
  resolveSolanaEnv,
} from "../packages/solana-rpc/src/index.ts";

type OverviewResponse = {
  data?: {
    programId: string;
    settingsPda: string;
    canonicalVaultAddress: string;
    policies?: Array<{
      seed: string;
      state: string;
      accountIndex: number;
    }>;
  };
  overview?: {
    programId: string;
    settingsPda: string;
    canonicalVaultAddress: string;
    policies?: Array<{
      seed: string;
      state: string;
      accountIndex: number;
    }>;
  };
};

type PositionResponse = {
  position?: {
    principalAmountRaw: string;
    closedAt?: string | null;
  } | null;
};

const API_BASE_URL = (
  process.env.FRONTEND_API_BASE_URL ?? "http://localhost:3000"
).replace(/\/$/, "");
const SOLANA_ENV = resolveSolanaEnv(
  process.env.NEXT_PUBLIC_SOLANA_ENV ?? process.env.SOLANA_ENV ?? "devnet"
);
const RPC_URL =
  process.env.RPC_URL ?? getSolanaEndpoints(SOLANA_ENV).rpcEndpoint;
const PROGRAM_ID = new PublicKey(
  process.env.LOYAL_SMART_ACCOUNTS_PROGRAM_ID ?? PROGRAM_ADDRESS
);
const FIRST_DEPOSIT_RAW = parseRawAmount(
  process.env.EARN_FIRST_DEPOSIT_RAW ?? "10000"
);
const TOP_UP_DEPOSIT_RAW = parseRawAmount(
  process.env.EARN_TOP_UP_DEPOSIT_RAW ?? "5000"
);
const PARTIAL_WITHDRAW_RAW = parseRawAmount(
  process.env.EARN_PARTIAL_WITHDRAW_RAW ?? "7000"
);
const RESUME_FIRST_DEPOSIT_SIGNATURE =
  process.env.EARN_FIRST_DEPOSIT_SIGNATURE?.trim() || null;
const RESUME_FIRST_DEPOSIT_SLOT =
  process.env.EARN_FIRST_DEPOSIT_SLOT?.trim() || null;
const RESUME_FIRST_POLICY_SIGNATURE =
  process.env.EARN_FIRST_POLICY_SIGNATURE?.trim() || null;
const RESUME_FIRST_POLICY_SLOT =
  process.env.EARN_FIRST_POLICY_SLOT?.trim() || null;
const RESUME_FIRST_SETUP_POLICY_SIGNATURE =
  process.env.EARN_FIRST_SETUP_POLICY_SIGNATURE?.trim() || null;
const RESUME_FIRST_SETUP_POLICY_SLOT =
  process.env.EARN_FIRST_SETUP_POLICY_SLOT?.trim() || null;
const RESUME_TOP_UP_DEPOSIT_SIGNATURE =
  process.env.EARN_TOP_UP_DEPOSIT_SIGNATURE?.trim() || null;
const RESUME_TOP_UP_DEPOSIT_SLOT =
  process.env.EARN_TOP_UP_DEPOSIT_SLOT?.trim() || null;
const RESUME_PARTIAL_WITHDRAW_SIGNATURE =
  process.env.EARN_PARTIAL_WITHDRAW_SIGNATURE?.trim() || null;
const RESUME_PARTIAL_WITHDRAW_SLOT =
  process.env.EARN_PARTIAL_WITHDRAW_SLOT?.trim() || null;
const RESUME_FULL_WITHDRAW_SIGNATURE =
  process.env.EARN_FULL_WITHDRAW_SIGNATURE?.trim() || null;
const RESUME_FULL_WITHDRAW_SLOT =
  process.env.EARN_FULL_WITHDRAW_SLOT?.trim() || null;
const EARN_TARGET = getKaminoUsdcEarnTargetForCluster(LoyalCluster.Devnet);
const KAMINO_DEVNET_USDC_RESERVE_COLLATERAL_MINT = new PublicKey(
  "8GoBXfEq3aTiWTxEP2tAaygJMx3LhG764iN5e6gqaLA"
);

function parseRawAmount(value: string): bigint {
  if (!/^\d+$/.test(value) || BigInt(value) <= 0n) {
    throw new Error(`Invalid positive raw amount: ${value}`);
  }
  return BigInt(value);
}

function loadTestingKeypair(): Keypair {
  const raw = process.env.SOLANA_TESTING_PK;
  if (!raw) {
    throw new Error("SOLANA_TESTING_PK is not set.");
  }

  const trimmed = raw.trim();
  if (trimmed.startsWith("[")) {
    return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(trimmed)));
  }

  if (/^[0-9a-fA-F]+$/.test(trimmed) && trimmed.length % 2 === 0) {
    return Keypair.fromSecretKey(
      Uint8Array.from(
        trimmed.match(/../g)!.map((byte) => Number.parseInt(byte, 16))
      )
    );
  }

  return Keypair.fromSecretKey(bs58.decode(trimmed));
}

function assertDevnet() {
  if (SOLANA_ENV !== "devnet") {
    throw new Error(
      `This verifier must run against devnet, got ${SOLANA_ENV}. Set NEXT_PUBLIC_SOLANA_ENV=devnet.`
    );
  }
}

async function postJson<T>(
  path: string,
  body: unknown,
  cookie?: string
): Promise<{
  body: T;
  setCookie: string | null;
}> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: API_BASE_URL,
      ...(cookie ? { Cookie: cookie } : {}),
    },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  const parsed = text ? JSON.parse(text) : null;

  if (!response.ok) {
    throw new Error(
      `${path} failed with ${response.status}: ${JSON.stringify(parsed)}`
    );
  }

  return {
    body: parsed as T,
    setCookie: response.headers.get("set-cookie"),
  };
}

async function getJson<T>(path: string, cookie: string): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    headers: {
      Cookie: cookie,
      Origin: API_BASE_URL,
    },
  });
  const text = await response.text();
  const parsed = text ? JSON.parse(text) : null;

  if (!response.ok) {
    throw new Error(
      `${path} failed with ${response.status}: ${JSON.stringify(parsed)}`
    );
  }

  return parsed as T;
}

function toCookieHeader(setCookie: string | null): string {
  if (!setCookie) {
    throw new Error("Auth completion did not return a session cookie.");
  }

  const firstCookie = setCookie.split(";")[0];
  if (!firstCookie) {
    throw new Error("Auth completion returned an invalid session cookie.");
  }
  return firstCookie;
}

async function authenticate(wallet: Keypair): Promise<string> {
  const challenge = await postJson<{ challengeToken: string; message: string }>(
    "/api/auth/wallet/challenge",
    { walletAddress: wallet.publicKey.toBase58() }
  );
  const signature = bs58.encode(
    nacl.sign.detached(
      new TextEncoder().encode(challenge.body.message),
      wallet.secretKey
    )
  );
  const complete = await postJson("/api/auth/wallet/complete", {
    challengeToken: challenge.body.challengeToken,
    signature,
  });

  return toCookieHeader(complete.setCookie);
}

async function resolveConfirmedSignatureSlot(args: {
  connection: Connection;
  signature: string;
}): Promise<string> {
  const { value } = await args.connection.getSignatureStatuses(
    [args.signature],
    { searchTransactionHistory: true }
  );
  const status = value[0];
  if (!status || status.err) {
    throw new Error(`Transaction ${args.signature} is not confirmed.`);
  }
  if (
    status.confirmationStatus !== "confirmed" &&
    status.confirmationStatus !== "finalized"
  ) {
    throw new Error(`Transaction ${args.signature} is not confirmed.`);
  }
  return status.slot.toString();
}

async function fetchOverview(cookie: string) {
  const response = await getJson<OverviewResponse>(
    "/api/smart-accounts/overview/base",
    cookie
  );
  const overview = response.data ?? response.overview;
  if (!overview) {
    throw new Error("Smart-account overview response did not include data.");
  }
  return overview;
}

async function fetchPolicies(cookie: string) {
  const response = await getJson<OverviewResponse>(
    "/api/smart-accounts/overview/policies",
    cookie
  );
  return response.data?.policies ?? response.overview?.policies ?? [];
}

async function fetchPosition(cookie: string) {
  return getJson<PositionResponse>(
    "/api/smart-accounts/yield-optimization/position",
    cookie
  );
}

async function assertWalletHasUsdc(connection: Connection, wallet: PublicKey) {
  const usdcMint = EARN_TARGET.liquidityMint;
  const ata = getAssociatedTokenAddressSync(usdcMint, wallet);
  const balance = await connection
    .getTokenAccountBalance(ata)
    .catch(() => null);
  const required = FIRST_DEPOSIT_RAW + TOP_UP_DEPOSIT_RAW;
  const amount = balance ? BigInt(balance.value.amount) : 0n;

  if (amount < required) {
    throw new Error(
      `Testing wallet needs at least ${required} raw USDC, found ${amount}. Wallet=${wallet.toBase58()} ata=${ata.toBase58()}`
    );
  }
}

function createWalletAdapter(wallet: Keypair) {
  return {
    publicKey: wallet.publicKey,
    async signTransaction<T extends Transaction | VersionedTransaction>(
      transaction: T
    ): Promise<T> {
      if (transaction instanceof VersionedTransaction) {
        transaction.sign([wallet]);
        return transaction;
      }
      transaction.partialSign(wallet);
      return transaction;
    },
  };
}

async function ensureDevnetVaultCollateralAta(args: {
  connection: Connection;
  wallet: Keypair;
  vaultPda: PublicKey;
}) {
  const collateralAta = getAssociatedTokenAddressSync(
    KAMINO_DEVNET_USDC_RESERVE_COLLATERAL_MINT,
    args.vaultPda,
    true,
    TOKEN_PROGRAM_ID
  );
  const transaction = new Transaction().add(
    createAssociatedTokenAccountIdempotentInstruction(
      args.wallet.publicKey,
      collateralAta,
      args.vaultPda,
      KAMINO_DEVNET_USDC_RESERVE_COLLATERAL_MINT,
      TOKEN_PROGRAM_ID
    )
  );
  const latestBlockhash = await args.connection.getLatestBlockhash("confirmed");
  transaction.feePayer = args.wallet.publicKey;
  transaction.recentBlockhash = latestBlockhash.blockhash;
  transaction.sign(args.wallet);
  const signature = await args.connection.sendRawTransaction(
    transaction.serialize()
  );
  const confirmation = await args.connection.confirmTransaction(
    {
      signature,
      blockhash: latestBlockhash.blockhash,
      lastValidBlockHeight: latestBlockhash.lastValidBlockHeight,
    },
    "confirmed"
  );
  if (confirmation.value.err) {
    throw new Error(
      `Collateral ATA preflight failed: ${JSON.stringify(
        confirmation.value.err
      )}`
    );
  }
  console.log(`collateral ATA ready: ${collateralAta.toBase58()}`);
}

async function prepareDeposit(args: {
  amountRaw: bigint;
  cookie: string;
}): Promise<SmartAccountPreparedEarnUsdcDeposit> {
  const response = await postJson<EarnDepositPrepareResponse>(
    "/api/smart-accounts/yield-optimization/deposits/prepare",
    {
      amountRaw: args.amountRaw.toString(),
      mint: EARN_TARGET.liquidityMint.toBase58(),
    },
    args.cookie
  );
  return hydratePreparedEarnUsdcDeposit(response.body.preparedDeposit);
}

async function confirmDeposit(args: {
  cookie: string;
  policyConfirmedSlot?: string;
  policySignature?: string;
  preparedDeposit: SmartAccountPreparedEarnUsdcDeposit;
  setupPolicyConfirmedSlot?: string;
  setupPolicySignature?: string;
  signature: string;
  confirmedSlot: string;
  smartAccountAddress: string;
}) {
  return postJson<PositionResponse>(
    "/api/smart-accounts/yield-optimization/deposits/confirm",
    buildEarnDepositConfirmRequestBody({
      smartAccountAddress: args.smartAccountAddress,
      policyConfirmedSlot: args.policyConfirmedSlot,
      policySignature: args.policySignature,
      preparedDeposit: args.preparedDeposit,
      setupPolicyConfirmedSlot: args.setupPolicyConfirmedSlot,
      setupPolicySignature: args.setupPolicySignature,
      signature: args.signature,
      confirmedSlot: args.confirmedSlot,
    }),
    args.cookie
  );
}

async function prepareWithdrawal(args: {
  amountRaw: bigint;
  cookie: string;
  mode: "partial" | "full";
}): Promise<SmartAccountPreparedEarnUsdcWithdraw> {
  const response = await postJson<EarnWithdrawPrepareResponse>(
    "/api/smart-accounts/yield-optimization/withdrawals/prepare",
    { amountRaw: args.amountRaw.toString(), mode: args.mode },
    args.cookie
  );
  return hydratePreparedEarnUsdcWithdraw(response.body.preparedWithdraw);
}

async function confirmWithdrawal(args: {
  cookie: string;
  preparedWithdraw: SmartAccountPreparedEarnUsdcWithdraw;
  signature: string;
  confirmedSlot: string;
  smartAccountAddress: string;
}) {
  return postJson<PositionResponse>(
    "/api/smart-accounts/yield-optimization/withdrawals/confirm",
    buildEarnWithdrawalConfirmRequestBody({
      smartAccountAddress: args.smartAccountAddress,
      preparedWithdraw: args.preparedWithdraw,
      signature: args.signature,
      confirmedSlot: args.confirmedSlot,
    }),
    args.cookie
  );
}

async function executePrepared(args: {
  label: string;
  connection: Connection;
  wallet: Keypair;
  prepared: Parameters<typeof sendPreparedWithWallet>[0]["prepared"];
}) {
  const latestBlockhash = await args.connection.getLatestBlockhash("confirmed");
  const simulated = compilePreparedOperation({
    prepared: args.prepared,
    blockhash: latestBlockhash.blockhash,
  });
  simulated.sign([args.wallet]);
  const simulation = await args.connection.simulateTransaction(simulated, {
    commitment: "confirmed",
    sigVerify: true,
  });

  if (simulation.value.err) {
    throw new Error(
      `${args.label} simulation failed: ${JSON.stringify(
        simulation.value.err
      )}\n${simulation.value.logs?.join("\n") ?? ""}`
    );
  }

  const signature = await sendPreparedWithWallet({
    connection: args.connection,
    wallet: createWalletAdapter(args.wallet),
    prepared: args.prepared,
    confirm: true,
  });
  const confirmedSlot = await resolveConfirmedSignatureSlot({
    connection: args.connection,
    signature,
  });
  console.log(`${args.label}: ${signature} @ slot ${confirmedSlot}`);
  return { signature, confirmedSlot };
}

async function main() {
  assertDevnet();

  const wallet = loadTestingKeypair();
  const connection = new Connection(RPC_URL, { commitment: "confirmed" });

  console.log(`API: ${API_BASE_URL}`);
  console.log(`RPC: ${RPC_URL}`);
  console.log(`wallet: ${wallet.publicKey.toBase58()}`);
  console.log(`program: ${PROGRAM_ID.toBase58()}`);
  console.log(`kamino market: ${EARN_TARGET.market.toBase58()}`);
  console.log(`kamino reserve: ${EARN_TARGET.reserve.toBase58()}`);

  await assertWalletHasUsdc(connection, wallet.publicKey);

  const cookie = await authenticate(wallet);
  let overview = await fetchOverview(cookie);
  const policies = await fetchPolicies(cookie);
  overview = { ...overview, policies };
  const settingsPda = new PublicKey(overview.settingsPda);
  const earnVaultPda = pda.getSmartAccountPda({
    programId: PROGRAM_ID,
    settingsPda,
    accountIndex: 1,
  })[0];

  console.log(`settings: ${overview.settingsPda}`);
  console.log(`smart account: ${overview.canonicalVaultAddress}`);

  await ensureDevnetVaultCollateralAta({
    connection,
    wallet,
    vaultPda: earnVaultPda,
  });
  const firstDeposit = await prepareDeposit({
    amountRaw: FIRST_DEPOSIT_RAW,
    cookie,
  });
  let firstPolicySignature = RESUME_FIRST_POLICY_SIGNATURE;
  let firstPolicyConfirmedSlot = RESUME_FIRST_POLICY_SLOT;
  let firstSetupPolicySignature = RESUME_FIRST_SETUP_POLICY_SIGNATURE;
  let firstSetupPolicyConfirmedSlot = RESUME_FIRST_SETUP_POLICY_SLOT;
  if (firstDeposit.policySetupPrepared) {
    if (!firstDeposit.policyFinalizePrepared || !firstDeposit.setupPolicy) {
      throw new Error(
        "first deposit prepare did not include the setup init-obligation policy transaction"
      );
    }
    if (!firstPolicySignature) {
      const policyTx = await executePrepared({
        label: "earn route policy setup",
        connection,
        wallet,
        prepared: firstDeposit.policySetupPrepared,
      });
      firstPolicySignature = policyTx.signature;
      firstPolicyConfirmedSlot = policyTx.confirmedSlot;
    }
    if (!firstSetupPolicySignature) {
      const setupPolicyTx = await executePrepared({
        label: "earn init-obligation policy setup",
        connection,
        wallet,
        prepared: firstDeposit.policyFinalizePrepared,
      });
      firstSetupPolicySignature = setupPolicyTx.signature;
      firstSetupPolicyConfirmedSlot = setupPolicyTx.confirmedSlot;
    }
  }
  const firstDepositTx = RESUME_FIRST_DEPOSIT_SIGNATURE
    ? {
        signature: RESUME_FIRST_DEPOSIT_SIGNATURE,
        confirmedSlot:
          RESUME_FIRST_DEPOSIT_SLOT ??
          (await resolveConfirmedSignatureSlot({
            connection,
            signature: RESUME_FIRST_DEPOSIT_SIGNATURE,
          })),
      }
    : await executePrepared({
        label: "first deposit",
        connection,
        wallet,
        prepared: firstDeposit.prepared,
      });
  if (RESUME_FIRST_DEPOSIT_SIGNATURE) {
    console.log(
      `first deposit resume: ${firstDepositTx.signature} @ slot ${firstDepositTx.confirmedSlot}`
    );
  }
  await confirmDeposit({
    cookie,
    preparedDeposit: firstDeposit,
    policyConfirmedSlot: firstPolicyConfirmedSlot ?? undefined,
    policySignature: firstPolicySignature ?? undefined,
    setupPolicyConfirmedSlot: firstSetupPolicyConfirmedSlot ?? undefined,
    setupPolicySignature: firstSetupPolicySignature ?? undefined,
    signature: firstDepositTx.signature,
    confirmedSlot: firstDepositTx.confirmedSlot,
    smartAccountAddress: overview.canonicalVaultAddress,
  });

  overview = {
    ...overview,
    policies: await fetchPolicies(cookie),
  };

  const topUpDeposit = await prepareDeposit({
    amountRaw: TOP_UP_DEPOSIT_RAW,
    cookie,
  });
  const topUpTx = RESUME_TOP_UP_DEPOSIT_SIGNATURE
    ? {
        signature: RESUME_TOP_UP_DEPOSIT_SIGNATURE,
        confirmedSlot:
          RESUME_TOP_UP_DEPOSIT_SLOT ??
          (await resolveConfirmedSignatureSlot({
            connection,
            signature: RESUME_TOP_UP_DEPOSIT_SIGNATURE,
          })),
      }
    : await executePrepared({
        label: "top-up deposit",
        connection,
        wallet,
        prepared: topUpDeposit.prepared,
      });
  if (RESUME_TOP_UP_DEPOSIT_SIGNATURE) {
    console.log(
      `top-up deposit resume: ${topUpTx.signature} @ slot ${topUpTx.confirmedSlot}`
    );
  }
  await confirmDeposit({
    cookie,
    preparedDeposit: topUpDeposit,
    signature: topUpTx.signature,
    confirmedSlot: topUpTx.confirmedSlot,
    smartAccountAddress: overview.canonicalVaultAddress,
  });

  const partialWithdraw = await prepareWithdrawal({
    amountRaw: PARTIAL_WITHDRAW_RAW,
    cookie,
    mode: "partial",
  });
  const partialWithdrawTx = RESUME_PARTIAL_WITHDRAW_SIGNATURE
    ? {
        signature: RESUME_PARTIAL_WITHDRAW_SIGNATURE,
        confirmedSlot:
          RESUME_PARTIAL_WITHDRAW_SLOT ??
          (await resolveConfirmedSignatureSlot({
            connection,
            signature: RESUME_PARTIAL_WITHDRAW_SIGNATURE,
          })),
      }
    : await executePrepared({
        label: "partial withdrawal",
        connection,
        wallet,
        prepared: partialWithdraw.prepared,
      });
  if (RESUME_PARTIAL_WITHDRAW_SIGNATURE) {
    console.log(
      `partial withdrawal resume: ${partialWithdrawTx.signature} @ slot ${partialWithdrawTx.confirmedSlot}`
    );
  }
  await confirmWithdrawal({
    cookie,
    preparedWithdraw: partialWithdraw,
    signature: partialWithdrawTx.signature,
    confirmedSlot: partialWithdrawTx.confirmedSlot,
    smartAccountAddress: overview.canonicalVaultAddress,
  });

  const remainingRaw =
    FIRST_DEPOSIT_RAW + TOP_UP_DEPOSIT_RAW - PARTIAL_WITHDRAW_RAW;
  const fullWithdraw = await prepareWithdrawal({
    amountRaw: remainingRaw,
    cookie,
    mode: "full",
  });
  const fullWithdrawTx = RESUME_FULL_WITHDRAW_SIGNATURE
    ? {
        signature: RESUME_FULL_WITHDRAW_SIGNATURE,
        confirmedSlot:
          RESUME_FULL_WITHDRAW_SLOT ??
          (await resolveConfirmedSignatureSlot({
            connection,
            signature: RESUME_FULL_WITHDRAW_SIGNATURE,
          })),
      }
    : await executePrepared({
        label: "full withdrawal",
        connection,
        wallet,
        prepared: fullWithdraw.prepared,
      });
  if (RESUME_FULL_WITHDRAW_SIGNATURE) {
    console.log(
      `full withdrawal resume: ${fullWithdrawTx.signature} @ slot ${fullWithdrawTx.confirmedSlot}`
    );
  }
  await confirmWithdrawal({
    cookie,
    preparedWithdraw: fullWithdraw,
    signature: fullWithdrawTx.signature,
    confirmedSlot: fullWithdrawTx.confirmedSlot,
    smartAccountAddress: overview.canonicalVaultAddress,
  });

  const finalPosition = await fetchPosition(cookie);
  console.log(
    `final position principal: ${
      finalPosition.position?.principalAmountRaw ?? "null"
    }`
  );
  console.log("devnet earn flow verification complete");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : error);
  process.exit(1);
});
