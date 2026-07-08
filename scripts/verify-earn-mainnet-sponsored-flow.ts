import { mock } from "bun:test";
import { Connection } from "@solana/web3.js";

import {
  buildEarnAutodepositCloseConfirmRequestBody,
  type EarnAutodepositCloseConfirmResponse,
  type EarnSponsoredAutodepositCloseConfirmRequestBody,
} from "../frontend/src/lib/yield-optimization/earn-autodeposit-prepare-contracts.shared.ts";
import {
  type EarnSponsoredDepositConfirmRequestBody,
  type EarnSponsoredPolicyConfirmRequestBody,
  type EarnSponsoredWithdrawalConfirmRequestBody,
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
import {
  hydratePreparedEarnUsdcYieldRoutingPolicy,
  type EarnPolicyPrepareResponse,
} from "../frontend/src/lib/yield-optimization/earn-policy-prepare-contracts.shared.ts";
import {
  getSolanaEndpoints,
  resolveSolanaEnv,
} from "../packages/solana-rpc/src/index.ts";
import type {
  SmartAccountPreparedEarnUsdcAutodepositClose,
  SmartAccountPreparedEarnUsdcDeposit,
  SmartAccountPreparedEarnUsdcWithdraw,
  SmartAccountPreparedEarnUsdcYieldRoutingPolicy,
} from "../packages/smart-account-vaults/src/types.ts";
import {
  authenticateFrontendSession,
  bigintJson,
  createKeypairWallet,
  frontendGetJson,
  frontendPostJson,
  loadSponsorFeePayer,
  loadTestingKeypair,
  parsePositiveRawAmount,
  signPreparedEarnOperationForSponsorship,
  signPreparedEarnOperationsForSponsorship,
  type FrontendSession,
  type SponsoredTransactionConfirmation,
} from "./verify-earn-sponsored-flow-helpers.ts";

mock.module("server-only", () => ({}));

// Usage:
// op run --env-file=.env.mainnet.1password -- sh -c '\
//   EARN_VERIFY_SOLANA_TESTING_PK="$(cat /path/to/wallet.json)" \
//   EARN_VERIFY_EXPECTED_WALLET_ADDRESS=<wallet> \
//   EARN_SETTINGS_PDA=<settings> \
//   NEXT_PUBLIC_SOLANA_ENV=mainnet \
//   EARN_VERIFY_FRONTEND_BASE_URL=http://localhost:3000 \
//   bun scripts/verify-earn-mainnet-sponsored-flow.ts'
//
// This is a live mainnet sponsored verifier. It signs user-side transactions,
// then asks the frontend backend to sponsor execution and record confirmations.

type SponsoredPolicyConfirmResponse = {
  sponsoredConfirmations?: {
    policy: SponsoredTransactionConfirmation;
    setupPolicy?: SponsoredTransactionConfirmation | null;
  };
};

type SponsoredDepositConfirmResponse = {
  sponsoredConfirmations?: {
    deposit: SponsoredTransactionConfirmation;
    kaminoSetup?: SponsoredTransactionConfirmation | null;
    policy: SponsoredTransactionConfirmation;
    setupPolicy?: SponsoredTransactionConfirmation | null;
  };
};

type SponsoredWithdrawConfirmResponse = {
  sponsoredConfirmations?: {
    policyClose?: SponsoredTransactionConfirmation | null;
    withdrawal: SponsoredTransactionConfirmation;
  };
};

type SponsoredAutodepositCloseConfirmResponse =
  EarnAutodepositCloseConfirmResponse & {
    sponsoredConfirmations?: {
      close: SponsoredTransactionConfirmation;
    };
  };

type EvidenceStep = {
  attempts?: unknown[];
  backend?: unknown;
  confirmedSlot?: string;
  endpoint?: string;
  error?: string;
  instructionCount?: number;
  nativeSolRequirement?: unknown;
  persistence?: unknown;
  prefund?: unknown;
  signature?: string;
  sponsoredConfirmations?: unknown;
  status: "failed" | "skipped" | "success";
};

type EarnStateForFullWithdraw = {
  position?: {
    currentHolding?: {
      amountRaw?: string;
      liquidityMint?: string;
      market?: string | null;
      reserve?: string;
    } | null;
    currentTotalAmountRaw?: string;
    status?: string;
  } | null;
};

const SOLANA_ENV = resolveSolanaEnv(
  process.env.NEXT_PUBLIC_SOLANA_ENV ?? process.env.SOLANA_ENV ?? "mainnet"
);
const FRONTEND_BASE_URL =
  process.env.EARN_VERIFY_FRONTEND_BASE_URL?.replace(/\/+$/, "") || null;
const FRONTEND_SESSION_COOKIE =
  process.env.EARN_VERIFY_FRONTEND_COOKIE?.trim() || null;
const FRONTEND_TURNSTILE_TOKEN =
  process.env.EARN_VERIFY_TURNSTILE_TOKEN?.trim() || "local-bypass";
const RPC_URL =
  process.env.SOLANA_RPC_URL ??
  process.env.RPC_URL ??
  getSolanaEndpoints(SOLANA_ENV).rpcEndpoint;
const DEPOSIT_AMOUNT_RAW = parsePositiveRawAmount(
  process.env.EARN_SPONSORED_DEPOSIT_AMOUNT_RAW ??
    process.env.EARN_FIRST_DEPOSIT_RAW ??
    "10000",
  "EARN_SPONSORED_DEPOSIT_AMOUNT_RAW"
);
const POLICY_REUSE_ATTEMPTS = Number.parseInt(
  process.env.EARN_SPONSORED_DEPOSIT_POLICY_REUSE_ATTEMPTS ?? "8",
  10
);
const POLICY_REUSE_DELAY_MS = Number.parseInt(
  process.env.EARN_SPONSORED_DEPOSIT_POLICY_REUSE_DELAY_MS ?? "1000",
  10
);

function assertMainnet() {
  if (SOLANA_ENV !== "mainnet") {
    throw new Error(
      `verify-earn-mainnet-sponsored-flow requires NEXT_PUBLIC_SOLANA_ENV=mainnet, got ${SOLANA_ENV}.`
    );
  }
  if (process.env.EARN_SPONSORED_VERIFY_DRY_RUN === "1") {
    throw new Error(
      "EARN_SPONSORED_VERIFY_DRY_RUN=1 is not implemented because sponsored confirm endpoints execute live transactions."
    );
  }
  if (!Number.isFinite(POLICY_REUSE_ATTEMPTS) || POLICY_REUSE_ATTEMPTS <= 0) {
    throw new Error(
      "EARN_SPONSORED_DEPOSIT_POLICY_REUSE_ATTEMPTS must be a positive integer."
    );
  }
  if (!Number.isFinite(POLICY_REUSE_DELAY_MS) || POLICY_REUSE_DELAY_MS < 0) {
    throw new Error(
      "EARN_SPONSORED_DEPOSIT_POLICY_REUSE_DELAY_MS must be a non-negative integer."
    );
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function redactSensitive(value: string): string {
  return value.replace(
    /([?&](?:api-key|apikey|key|token)=)[^&\s"'`)]+/gi,
    "$1[REDACTED]"
  );
}

async function fetchEarnState(args: {
  session: FrontendSession;
}): Promise<unknown> {
  const response = await frontendGetJson<unknown>({
    cookie: args.session.cookie,
    path: "/api/smart-accounts/yield-optimization/earn-state",
    session: args.session,
  });

  return response.body;
}

async function prepareEarnPolicyOnServer(args: {
  session: FrontendSession;
}): Promise<SmartAccountPreparedEarnUsdcYieldRoutingPolicy> {
  const response = await frontendPostJson<EarnPolicyPrepareResponse>({
    body: { sponsored: true },
    cookie: args.session.cookie,
    path: "/api/smart-accounts/yield-optimization/policies/prepare",
    session: args.session,
  });

  return hydratePreparedEarnUsdcYieldRoutingPolicy(
    response.body.preparedPolicy
  );
}

async function prepareSponsoredEarnDepositOnServer(args: {
  amountRaw: bigint;
  session: FrontendSession;
}): Promise<SmartAccountPreparedEarnUsdcDeposit> {
  const response = await frontendPostJson<EarnDepositPrepareResponse>({
    body: {
      amountRaw: args.amountRaw.toString(),
      sponsored: true,
    },
    cookie: args.session.cookie,
    path: "/api/smart-accounts/yield-optimization/deposits/prepare",
    session: args.session,
  });

  return hydratePreparedEarnUsdcDeposit(response.body.preparedDeposit);
}

async function prepareSponsoredEarnFullWithdrawOnServer(args: {
  amountRaw: bigint;
  session: FrontendSession;
  source: NonNullable<EarnStateForFullWithdraw["position"]>["currentHolding"];
}): Promise<SmartAccountPreparedEarnUsdcWithdraw> {
  const source = args.source;
  const response = await frontendPostJson<EarnWithdrawPrepareResponse>({
    body: {
      amountRaw: args.amountRaw.toString(),
      mode: "full",
      ...(source?.amountRaw &&
      source.liquidityMint &&
      source.market &&
      source.reserve
        ? {
            source: {
              amountRaw: source.amountRaw,
              id: source.reserve,
              liquidityMint: source.liquidityMint,
              market: source.market,
              reserve: source.reserve,
              type: "reserve",
            },
          }
        : {}),
      sponsored: true,
    },
    cookie: args.session.cookie,
    path: "/api/smart-accounts/yield-optimization/withdrawals/prepare",
    session: args.session,
  });

  return hydratePreparedEarnUsdcWithdraw(response.body.preparedWithdraw);
}

async function postSponsoredEarnPolicySetup(args: {
  connection: Connection;
  preparedPolicy: SmartAccountPreparedEarnUsdcYieldRoutingPolicy;
  session: FrontendSession;
  sponsorFeePayer: ReturnType<typeof loadSponsorFeePayer>;
  wallet: ReturnType<typeof createKeypairWallet>;
}): Promise<SponsoredPolicyConfirmResponse> {
  if (!args.preparedPolicy.finalizePrepared) {
    throw new Error("Prepared Earn policy is missing setup finalize stage.");
  }

  const signedTransactions = await signPreparedEarnOperationsForSponsorship<
    "route_policy" | "setup_policy"
  >({
    connection: args.connection,
    feePayer: args.sponsorFeePayer,
    preparedStages: [
      {
        operation: "sponsored Earn route policy setup",
        prepared: args.preparedPolicy.prepared,
        stage: "route_policy",
      },
      {
        operation: "sponsored Earn setup policy setup",
        prepared: args.preparedPolicy.finalizePrepared,
        stage: "setup_policy",
      },
    ],
    wallet: args.wallet,
  });
  const policyTransaction = signedTransactions.get("route_policy");
  const setupPolicyTransaction = signedTransactions.get("setup_policy");
  if (!policyTransaction || !setupPolicyTransaction) {
    throw new Error("Sponsored policy setup did not produce both stages.");
  }

  const body: EarnSponsoredPolicyConfirmRequestBody = {
    ...args.preparedPolicy.persistence,
    policyTransaction,
    setupPolicyTransaction,
    stage: "setup_policy",
  };
  const response = await frontendPostJson<SponsoredPolicyConfirmResponse>({
    body,
    cookie: args.session.cookie,
    path: "/api/smart-accounts/yield-optimization/policies/confirm/sponsored",
    session: args.session,
  });
  if (!response.body.sponsoredConfirmations) {
    throw new Error("Sponsored Earn policy response is missing confirmations.");
  }

  return response.body;
}

async function prepareSponsoredDepositReusingPolicy(args: {
  amountRaw: bigint;
  evidenceAttempts: unknown[];
  session: FrontendSession;
}): Promise<SmartAccountPreparedEarnUsdcDeposit> {
  let lastPrepared: SmartAccountPreparedEarnUsdcDeposit | null = null;
  for (let attempt = 1; attempt <= POLICY_REUSE_ATTEMPTS; attempt += 1) {
    lastPrepared = await prepareSponsoredEarnDepositOnServer({
      amountRaw: args.amountRaw,
      session: args.session,
    });
    args.evidenceAttempts.push({
      attempt,
      policyAccount: lastPrepared.persistence.policyAccount,
      policyInitialization: lastPrepared.persistence.policyInitialization,
      policySeed: lastPrepared.persistence.policySeed,
    });
    if (lastPrepared.persistence.policyInitialization === "reuse") {
      return lastPrepared;
    }
    await fetchEarnState({ session: args.session }).catch(() => null);
    await sleep(POLICY_REUSE_DELAY_MS);
  }

  throw new Error(
    `Sponsored deposit prepare still wants policyInitialization=${
      lastPrepared?.persistence.policyInitialization ?? "unknown"
    } after ${POLICY_REUSE_ATTEMPTS} attempts. The verifier already called /policies/confirm/sponsored, so refusing to create another policy.`
  );
}

async function postSponsoredEarnDeposit(args: {
  depositTransaction: string;
  kaminoSetupTransaction?: string | null;
  policyTransaction?: string | null;
  preparedDeposit: SmartAccountPreparedEarnUsdcDeposit;
  session: FrontendSession;
  setupPolicyTransaction?: string | null;
}): Promise<SponsoredDepositConfirmResponse> {
  const body: EarnSponsoredDepositConfirmRequestBody = {
    ...args.preparedDeposit.persistence,
    depositTransaction: args.depositTransaction,
    ...(args.kaminoSetupTransaction
      ? { kaminoSetupTransaction: args.kaminoSetupTransaction }
      : {}),
    ...(args.policyTransaction
      ? { policyTransaction: args.policyTransaction }
      : {}),
    ...(args.setupPolicyTransaction
      ? { setupPolicyTransaction: args.setupPolicyTransaction }
      : {}),
    smartAccountAddress: args.preparedDeposit.vault.pubkey.toBase58(),
  };
  const response = await frontendPostJson<SponsoredDepositConfirmResponse>({
    body,
    cookie: args.session.cookie,
    path: "/api/smart-accounts/yield-optimization/deposits/confirm/sponsored",
    session: args.session,
  });
  if (!response.body.sponsoredConfirmations) {
    throw new Error(
      "Sponsored Earn deposit response is missing confirmations."
    );
  }

  return response.body;
}

function resolveFullWithdrawRequest(state: unknown): {
  amountRaw: bigint;
  source: EarnStateForFullWithdraw["position"] extends infer T
    ? T extends { currentHolding?: infer U }
      ? U
      : null
    : null;
} {
  const earnState = state as EarnStateForFullWithdraw;
  const position = earnState.position;
  const holding = position?.currentHolding ?? null;
  const amountRaw =
    holding?.amountRaw && /^\d+$/.test(holding.amountRaw)
      ? BigInt(holding.amountRaw)
      : position?.currentTotalAmountRaw &&
        /^\d+$/.test(position.currentTotalAmountRaw)
      ? BigInt(position.currentTotalAmountRaw)
      : BigInt(0);

  if (!position || position.status !== "active" || amountRaw <= BigInt(0)) {
    throw new Error("No active Earn position is available for full withdraw.");
  }

  return {
    amountRaw,
    source: holding,
  };
}

function buildSponsoredEarnWithdrawConfirmBody(args: {
  autodepositCloseConfirmedSlot?: string;
  autodepositCloseSignature?: string;
  policyCloseTransaction?: string | null;
  preparedStep: SmartAccountPreparedEarnUsdcWithdraw["withdrawSteps"][number];
  preparedWithdraw: SmartAccountPreparedEarnUsdcWithdraw;
  smartAccountAddress: string;
  withdrawalTransaction: string;
}): EarnSponsoredWithdrawalConfirmRequestBody {
  const body = buildEarnWithdrawalConfirmRequestBody({
    autodepositCloseConfirmedSlot: args.autodepositCloseConfirmedSlot,
    autodepositCloseSignature: args.autodepositCloseSignature,
    confirmedSlot: "0",
    preparedStep: args.preparedStep,
    preparedWithdraw: args.preparedWithdraw,
    signature: "sponsored-withdrawal-signature-placeholder",
    smartAccountAddress: args.smartAccountAddress,
  }) as Partial<
    ReturnType<typeof buildEarnWithdrawalConfirmRequestBody>
  > as EarnSponsoredWithdrawalConfirmRequestBody & {
    confirmedSlot?: string;
    withdrawalSignature?: string;
  };
  delete body.confirmedSlot;
  delete body.withdrawalSignature;
  if (args.policyCloseTransaction) {
    body.policyCloseTransaction = args.policyCloseTransaction;
  }
  body.withdrawalTransaction = args.withdrawalTransaction;
  return body;
}

function buildSponsoredAutodepositCloseConfirmBody(args: {
  closeTransaction: string;
  preparedClose: SmartAccountPreparedEarnUsdcAutodepositClose;
}): EarnSponsoredAutodepositCloseConfirmRequestBody {
  const body = buildEarnAutodepositCloseConfirmRequestBody({
    confirmedSlot: "0",
    preparedClose: args.preparedClose,
    signature: "sponsored-autodeposit-close-signature-placeholder",
  }) as Partial<
    ReturnType<typeof buildEarnAutodepositCloseConfirmRequestBody>
  > as EarnSponsoredAutodepositCloseConfirmRequestBody & {
    closeSignature?: string;
    confirmedSlot?: string;
  };
  delete body.closeSignature;
  delete body.confirmedSlot;
  body.closeTransaction = args.closeTransaction;
  return body;
}

async function postSponsoredEarnAutodepositClose(args: {
  closeTransaction: string;
  preparedClose: SmartAccountPreparedEarnUsdcAutodepositClose;
  session: FrontendSession;
}): Promise<SponsoredAutodepositCloseConfirmResponse> {
  const response =
    await frontendPostJson<SponsoredAutodepositCloseConfirmResponse>({
      body: buildSponsoredAutodepositCloseConfirmBody(args),
      cookie: args.session.cookie,
      path: "/api/smart-accounts/yield-optimization/autodeposit/close/confirm/sponsored",
      session: args.session,
    });
  if (!response.body.sponsoredConfirmations) {
    throw new Error(
      "Sponsored Autodeposit close response is missing confirmations."
    );
  }

  return response.body;
}

async function postSponsoredEarnFullWithdraw(args: {
  autodepositCloseConfirmedSlot?: string;
  autodepositCloseSignature?: string;
  policyCloseTransaction?: string | null;
  preparedStep: SmartAccountPreparedEarnUsdcWithdraw["withdrawSteps"][number];
  preparedWithdraw: SmartAccountPreparedEarnUsdcWithdraw;
  session: FrontendSession;
  withdrawalTransaction: string;
}): Promise<SponsoredWithdrawConfirmResponse> {
  const response = await frontendPostJson<SponsoredWithdrawConfirmResponse>({
    body: buildSponsoredEarnWithdrawConfirmBody({
      autodepositCloseConfirmedSlot: args.autodepositCloseConfirmedSlot,
      autodepositCloseSignature: args.autodepositCloseSignature,
      policyCloseTransaction: args.policyCloseTransaction,
      preparedStep: args.preparedStep,
      preparedWithdraw: args.preparedWithdraw,
      smartAccountAddress: args.preparedWithdraw.vault.pubkey.toBase58(),
      withdrawalTransaction: args.withdrawalTransaction,
    }),
    cookie: args.session.cookie,
    path: "/api/smart-accounts/yield-optimization/withdrawals/confirm/sponsored",
    session: args.session,
  });
  if (!response.body.sponsoredConfirmations) {
    throw new Error(
      "Sponsored Earn withdrawal response is missing confirmations."
    );
  }

  return response.body;
}

async function main() {
  assertMainnet();

  const connection = new Connection(RPC_URL, "confirmed");
  const wallet = loadTestingKeypair();
  const walletBridge = createKeypairWallet(wallet);
  const sponsorFeePayer = loadSponsorFeePayer();
  const session = await authenticateFrontendSession({
    baseUrl: FRONTEND_BASE_URL,
    keypair: wallet,
    sessionCookie: FRONTEND_SESSION_COOKIE,
    turnstileToken: FRONTEND_TURNSTILE_TOKEN,
  });
  const evidence: {
    config: Record<string, unknown>;
    steps: Record<string, EvidenceStep>;
  } = {
    config: {
      amountRaw: DEPOSIT_AMOUNT_RAW.toString(),
      frontendBaseUrl: FRONTEND_BASE_URL,
      rpcUrl: redactSensitive(RPC_URL),
      settingsPda: session.settingsPda,
      smartAccountAddress: session.smartAccountAddress,
      solanaEnv: SOLANA_ENV,
      sponsorFeePayer: sponsorFeePayer.toBase58(),
      walletAddress: wallet.publicKey.toBase58(),
    },
    steps: {},
  };

  const initialEarnState = (await fetchEarnState({ session })) as {
    policy?: {
      lastSeenSignature?: string | null;
      setupPolicy?: { lastSeenSignature?: string | null } | null;
    } | null;
  };
  const existingPolicy = initialEarnState.policy;
  if (
    existingPolicy?.lastSeenSignature &&
    existingPolicy.setupPolicy?.lastSeenSignature
  ) {
    evidence.steps.policyPrepare = {
      reason: "existing confirmed Earn policy pair",
      status: "skipped",
    };
    evidence.steps.policySponsoredConfirm = {
      backend: initialEarnState,
      endpoint:
        "/api/smart-accounts/yield-optimization/policies/confirm/sponsored",
      reason: "existing confirmed Earn policy pair",
      status: "skipped",
    };
  } else {
    const preparedPolicy = await prepareEarnPolicyOnServer({ session });
    evidence.steps.policyPrepare = {
      instructionCount:
        preparedPolicy.prepared.instructions.length +
        (preparedPolicy.finalizePrepared?.instructions.length ?? 0),
      persistence: preparedPolicy.persistence,
      status: "success",
    };
    const policyResponse = await postSponsoredEarnPolicySetup({
      connection,
      preparedPolicy,
      session,
      sponsorFeePayer,
      wallet: walletBridge,
    });
    evidence.steps.policySponsoredConfirm = {
      backend: policyResponse,
      endpoint:
        "/api/smart-accounts/yield-optimization/policies/confirm/sponsored",
      sponsoredConfirmations: policyResponse.sponsoredConfirmations,
      status: "success",
    };
  }
  evidence.steps.postPolicyEarnState = {
    backend: await fetchEarnState({ session }),
    status: "success",
  };

  const depositPrepareAttempts: unknown[] = [];
  const preparedDeposit = await prepareSponsoredDepositReusingPolicy({
    amountRaw: DEPOSIT_AMOUNT_RAW,
    evidenceAttempts: depositPrepareAttempts,
    session,
  });
  evidence.steps.depositPrepare = {
    attempts: depositPrepareAttempts,
    instructionCount:
      preparedDeposit.prepared.instructions.length +
      (preparedDeposit.kaminoSetupPrepared?.instructions.length ?? 0),
    nativeSolRequirement: preparedDeposit.nativeSolRequirement,
    persistence: preparedDeposit.persistence,
    status: "success",
  };

  const policyTransaction = preparedDeposit.policySetupPrepared
    ? await signPreparedEarnOperationForSponsorship({
        connection,
        feePayer: sponsorFeePayer,
        operation: "sponsored Earn deposit policy setup",
        prepared: preparedDeposit.policySetupPrepared,
        wallet: walletBridge,
      })
    : null;
  const setupPolicyTransaction = preparedDeposit.policyFinalizePrepared
    ? await signPreparedEarnOperationForSponsorship({
        connection,
        feePayer: sponsorFeePayer,
        operation: "sponsored Earn deposit setup policy setup",
        prepared: preparedDeposit.policyFinalizePrepared,
        wallet: walletBridge,
      })
    : null;
  const kaminoSetupTransaction = preparedDeposit.kaminoSetupPrepared
    ? await signPreparedEarnOperationForSponsorship({
        connection,
        feePayer: sponsorFeePayer,
        operation: "sponsored Earn Kamino setup",
        prepared: preparedDeposit.kaminoSetupPrepared,
        wallet: walletBridge,
      })
    : null;
  const depositTransaction = await signPreparedEarnOperationForSponsorship({
    connection,
    feePayer: sponsorFeePayer,
    operation: "sponsored Earn deposit",
    prepared: preparedDeposit.prepared,
    wallet: walletBridge,
  });
  const depositResponse = await postSponsoredEarnDeposit({
    depositTransaction,
    kaminoSetupTransaction,
    policyTransaction,
    preparedDeposit,
    session,
    setupPolicyTransaction,
  });
  evidence.steps.depositConfirm = {
    backend: depositResponse,
    confirmedSlot:
      depositResponse.sponsoredConfirmations?.deposit.confirmedSlot,
    endpoint:
      "/api/smart-accounts/yield-optimization/deposits/confirm/sponsored",
    signature: depositResponse.sponsoredConfirmations?.deposit.signature,
    sponsoredConfirmations: depositResponse.sponsoredConfirmations,
    status: "success",
  };
  evidence.steps.postDepositEarnState = {
    backend: await fetchEarnState({ session }),
    status: "success",
  };

  const withdrawRequest = resolveFullWithdrawRequest(
    evidence.steps.postDepositEarnState.backend
  );
  const preparedWithdraw = await prepareSponsoredEarnFullWithdrawOnServer({
    amountRaw: withdrawRequest.amountRaw,
    session,
    source: withdrawRequest.source,
  });
  const preparedStep =
    preparedWithdraw.withdrawSteps[preparedWithdraw.withdrawSteps.length - 1];
  if (!preparedStep) {
    throw new Error("Sponsored Earn full withdraw is missing withdraw steps.");
  }
  if (preparedStep.stepIndex !== preparedStep.stepCount - 1) {
    throw new Error(
      "Sponsored Earn verifier only supports the final full-withdraw step."
    );
  }
  evidence.steps.withdrawPrepare = {
    instructionCount:
      preparedStep.prepared.instructions.length +
      (preparedWithdraw.autodepositClosePrepared?.prepared.instructions
        .length ?? 0) +
      (preparedWithdraw.policyClosePrepared?.instructions.length ?? 0),
    persistence: preparedStep.persistence,
    status: "success",
  };

  let autodepositCloseConfirmedSlot: string | undefined;
  let autodepositCloseSignature: string | undefined;
  if (preparedWithdraw.autodepositClosePrepared) {
    const autodepositCloseTransaction =
      await signPreparedEarnOperationForSponsorship({
        connection,
        feePayer: sponsorFeePayer,
        operation: "sponsored Earn withdrawal Autodeposit close",
        prepared: preparedWithdraw.autodepositClosePrepared.prepared,
        wallet: walletBridge,
      });
    const autodepositCloseResponse = await postSponsoredEarnAutodepositClose({
      closeTransaction: autodepositCloseTransaction,
      preparedClose: preparedWithdraw.autodepositClosePrepared,
      session,
    });
    autodepositCloseConfirmedSlot =
      autodepositCloseResponse.sponsoredConfirmations?.close.confirmedSlot;
    autodepositCloseSignature =
      autodepositCloseResponse.sponsoredConfirmations?.close.signature;
    evidence.steps.withdrawAutodepositCloseConfirm = {
      backend: autodepositCloseResponse,
      confirmedSlot: autodepositCloseConfirmedSlot,
      endpoint:
        "/api/smart-accounts/yield-optimization/autodeposit/close/confirm/sponsored",
      signature: autodepositCloseSignature,
      sponsoredConfirmations: autodepositCloseResponse.sponsoredConfirmations,
      status: "success",
    };
  }

  const withdrawalTransaction = await signPreparedEarnOperationForSponsorship({
    connection,
    feePayer: sponsorFeePayer,
    operation: "sponsored Earn full withdraw",
    prepared: preparedStep.prepared,
    wallet: walletBridge,
  });
  const policyCloseTransaction = preparedWithdraw.policyClosePrepared
    ? await signPreparedEarnOperationForSponsorship({
        connection,
        feePayer: sponsorFeePayer,
        operation: "sponsored Earn policy close",
        prepared: preparedWithdraw.policyClosePrepared,
        wallet: walletBridge,
      })
    : null;
  const withdrawResponse = await postSponsoredEarnFullWithdraw({
    autodepositCloseConfirmedSlot,
    autodepositCloseSignature,
    policyCloseTransaction,
    preparedStep,
    preparedWithdraw,
    session,
    withdrawalTransaction,
  });
  evidence.steps.withdrawConfirm = {
    backend: withdrawResponse,
    confirmedSlot:
      withdrawResponse.sponsoredConfirmations?.withdrawal.confirmedSlot,
    endpoint:
      "/api/smart-accounts/yield-optimization/withdrawals/confirm/sponsored",
    signature: withdrawResponse.sponsoredConfirmations?.withdrawal.signature,
    sponsoredConfirmations: withdrawResponse.sponsoredConfirmations,
    status: "success",
  };
  evidence.steps.postWithdrawEarnState = {
    backend: await fetchEarnState({ session }),
    status: "success",
  };

  console.log("[earn-mainnet-sponsored] PASS");
  console.log(JSON.stringify(evidence, bigintJson, 2));
}

main().catch((error) => {
  console.error("[earn-mainnet-sponsored] FAIL", error);
  process.exit(1);
});
