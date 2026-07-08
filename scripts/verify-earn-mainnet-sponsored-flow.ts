import { mock } from "bun:test";
import { Connection } from "@solana/web3.js";

import type {
  EarnSponsoredDepositConfirmRequestBody,
  EarnSponsoredPolicyConfirmRequestBody,
} from "../frontend/src/lib/yield-optimization/earn-confirm-contracts.shared.ts";
import {
  hydratePreparedEarnUsdcDeposit,
  type EarnDepositPrepareResponse,
} from "../frontend/src/lib/yield-optimization/earn-deposit-prepare-contracts.shared.ts";
import {
  hydratePreparedEarnUsdcYieldRoutingPolicy,
  type EarnPolicyPrepareResponse,
} from "../frontend/src/lib/yield-optimization/earn-policy-prepare-contracts.shared.ts";
import {
  getSolanaEndpoints,
  resolveSolanaEnv,
} from "../packages/solana-rpc/src/index.ts";
import type {
  SmartAccountPreparedEarnUsdcDeposit,
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
  nativeSolRequirementError,
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
    policy: SponsoredTransactionConfirmation;
    setupPolicy?: SponsoredTransactionConfirmation | null;
  };
};

type EvidenceStep = {
  attempts?: unknown[];
  backend?: unknown;
  endpoint?: string;
  error?: string;
  instructionCount?: number;
  nativeSolRequirement?: unknown;
  persistence?: unknown;
  sponsoredConfirmations?: unknown;
  status: "failed" | "skipped" | "success";
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
  connection: Connection;
  preparedDeposit: SmartAccountPreparedEarnUsdcDeposit;
  session: FrontendSession;
  sponsorFeePayer: ReturnType<typeof loadSponsorFeePayer>;
  wallet: ReturnType<typeof createKeypairWallet>;
}): Promise<SponsoredDepositConfirmResponse> {
  const depositTransaction = await signPreparedEarnOperationForSponsorship({
    connection: args.connection,
    feePayer: args.sponsorFeePayer,
    operation: "sponsored Earn deposit",
    prepared: args.preparedDeposit.prepared,
    wallet: args.wallet,
  });
  const body: EarnSponsoredDepositConfirmRequestBody = {
    ...args.preparedDeposit.persistence,
    depositTransaction,
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
      rpcUrl: RPC_URL,
      settingsPda: session.settingsPda,
      smartAccountAddress: session.smartAccountAddress,
      solanaEnv: SOLANA_ENV,
      sponsorFeePayer: sponsorFeePayer.toBase58(),
      walletAddress: wallet.publicKey.toBase58(),
    },
    steps: {},
  };

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
  const nativeSolError = nativeSolRequirementError(
    preparedDeposit.nativeSolRequirement
  );
  if (nativeSolError) {
    throw new Error(nativeSolError);
  }
  evidence.steps.depositPrepare = {
    attempts: depositPrepareAttempts,
    instructionCount: preparedDeposit.prepared.instructions.length,
    nativeSolRequirement: preparedDeposit.nativeSolRequirement,
    persistence: preparedDeposit.persistence,
    status: "success",
  };
  const depositResponse = await postSponsoredEarnDeposit({
    connection,
    preparedDeposit,
    session,
    sponsorFeePayer,
    wallet: walletBridge,
  });
  evidence.steps.depositSponsoredConfirm = {
    backend: depositResponse,
    endpoint:
      "/api/smart-accounts/yield-optimization/deposits/confirm/sponsored",
    sponsoredConfirmations: depositResponse.sponsoredConfirmations,
    status: "success",
  };
  evidence.steps.postDepositEarnState = {
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
