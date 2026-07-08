import { mock } from "bun:test";
import { Connection, PublicKey } from "@solana/web3.js";

import {
  LoyalCluster,
  resolveLoyalClusterForSolanaEnv,
} from "../packages/loyal-actions/src/index.ts";
import { createSmartAccountVaultsClient } from "../packages/smart-account-vaults/src/index.ts";
import type {
  SmartAccountPreparedEarnUsdcAutodepositClose,
  SmartAccountPreparedEarnUsdcAutodepositSetup,
} from "../packages/smart-account-vaults/src/types.ts";
import {
  getSolanaEndpoints,
  resolveSolanaEnv,
} from "../packages/solana-rpc/src/index.ts";
import {
  buildEarnAutodepositCloseConfirmRequestBody,
  buildEarnAutodepositSetupConfirmRequestBody,
  type EarnAutodepositCloseConfirmResponse,
  type EarnAutodepositSetupConfirmResponse,
  type EarnSponsoredAutodepositCloseConfirmRequestBody,
  type EarnSponsoredAutodepositSetupConfirmRequestBody,
} from "../frontend/src/lib/yield-optimization/earn-autodeposit-prepare-contracts.shared.ts";
import { PROGRAM_ADDRESS } from "../sdk/loyal-smart-accounts/src/index.ts";
import {
  accountStatus,
  authenticateFrontendSession,
  bigintJson,
  createKeypairWallet,
  frontendGetJson,
  frontendPostJson,
  loadDeploymentPolicySignerPublicKey,
  loadSponsorFeePayer,
  loadTestingKeypair,
  parseNonNegativeRawAmount,
  parsePositiveRawAmount,
  signPreparedEarnOperationForSponsorship,
  waitForAccountStatus,
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
//   bun scripts/verify-earn-autodeposit-mainnet-sponsored-flow.ts'
//
// This is a live mainnet lifecycle verifier. It mirrors Autodeposit setup from
// the UI, but asks the backend sponsored setup endpoint to execute and record
// each setup transaction. Cleanup closes the created Autodeposit policy.

type SponsoredAutodepositSetupConfirmResponse =
  EarnAutodepositSetupConfirmResponse & {
    sponsoredConfirmations?: {
      setup: SponsoredTransactionConfirmation;
    };
  };

type SponsoredAutodepositCloseConfirmResponse =
  EarnAutodepositCloseConfirmResponse & {
    sponsoredConfirmations?: {
      close: SponsoredTransactionConfirmation;
    };
  };

type EvidenceStep = {
  accounts?: Record<string, unknown>;
  amountRaw?: string;
  backend?: unknown;
  confirmedSlot?: string;
  endpoint?: string;
  error?: string;
  instructionCount?: number;
  nativeSolRequirement?: unknown;
  persistence?: unknown;
  reason?: string;
  signature?: string;
  sponsored?: boolean;
  sponsoredConfirmations?: unknown;
  stage?: SmartAccountPreparedEarnUsdcAutodepositSetup["stage"];
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
const PROGRAM_ID = new PublicKey(
  process.env.LOYAL_SMART_ACCOUNTS_PROGRAM_ID ?? PROGRAM_ADDRESS
);
const AMOUNT_RAW = parsePositiveRawAmount(
  process.env.EARN_AUTODEPOSIT_SPONSORED_AMOUNT_RAW ??
    process.env.EARN_AUTODEPOSIT_AMOUNT_RAW ??
    "10000",
  "EARN_AUTODEPOSIT_SPONSORED_AMOUNT_RAW"
);
const WALLET_BALANCE_FLOOR_RAW = parseNonNegativeRawAmount(
  process.env.EARN_AUTODEPOSIT_WALLET_BALANCE_FLOOR_RAW ?? "0",
  "EARN_AUTODEPOSIT_WALLET_BALANCE_FLOOR_RAW"
);
const NONCE =
  process.env.EARN_AUTODEPOSIT_NONCE === undefined
    ? BigInt(Date.now())
    : parsePositiveRawAmount(
        process.env.EARN_AUTODEPOSIT_NONCE,
        "EARN_AUTODEPOSIT_NONCE"
      );
const PERIOD_LENGTH_SECONDS =
  process.env.EARN_AUTODEPOSIT_PERIOD_LENGTH_SECONDS === undefined
    ? undefined
    : parsePositiveRawAmount(
        process.env.EARN_AUTODEPOSIT_PERIOD_LENGTH_SECONDS,
        "EARN_AUTODEPOSIT_PERIOD_LENGTH_SECONDS"
      );
const START_TIMESTAMP =
  process.env.EARN_AUTODEPOSIT_START_TIMESTAMP === undefined
    ? undefined
    : parseNonNegativeRawAmount(
        process.env.EARN_AUTODEPOSIT_START_TIMESTAMP,
        "EARN_AUTODEPOSIT_START_TIMESTAMP"
      );
const EXPIRY_TIMESTAMP =
  process.env.EARN_AUTODEPOSIT_EXPIRY_TIMESTAMP === undefined
    ? undefined
    : parseNonNegativeRawAmount(
        process.env.EARN_AUTODEPOSIT_EXPIRY_TIMESTAMP,
        "EARN_AUTODEPOSIT_EXPIRY_TIMESTAMP"
      );
const REQUESTED_POLICY_SEED =
  process.env.EARN_AUTODEPOSIT_POLICY_SEED === undefined
    ? undefined
    : parsePositiveRawAmount(
        process.env.EARN_AUTODEPOSIT_POLICY_SEED,
        "EARN_AUTODEPOSIT_POLICY_SEED"
      );

function assertMainnet() {
  if (SOLANA_ENV !== "mainnet") {
    throw new Error(
      `verify-earn-autodeposit-mainnet-sponsored-flow requires NEXT_PUBLIC_SOLANA_ENV=mainnet, got ${SOLANA_ENV}.`
    );
  }
  if (process.env.EARN_AUTODEPOSIT_SPONSORED_VERIFY_DRY_RUN === "1") {
    throw new Error(
      "EARN_AUTODEPOSIT_SPONSORED_VERIFY_DRY_RUN=1 is not implemented because sponsored confirm endpoints execute live transactions."
    );
  }
}

function validatePreparedCluster(args: {
  cluster: LoyalCluster;
  operation: string;
  preparedCluster: string;
}) {
  if (args.preparedCluster !== args.cluster) {
    throw new Error(
      `Prepared ${args.operation} cluster ${args.preparedCluster} does not match ${args.cluster}.`
    );
  }
}

function getRequestedStartTimestamp(args: {
  expiryTimestamp?: bigint;
  startTimestamp?: bigint;
}): bigint | undefined {
  if (args.startTimestamp === undefined) {
    return undefined;
  }
  if (
    args.startTimestamp === BigInt(0) &&
    args.expiryTimestamp !== undefined &&
    args.expiryTimestamp > BigInt(0)
  ) {
    return args.startTimestamp;
  }

  const nowSeconds = BigInt(Math.floor(Date.now() / 1000));
  return args.startTimestamp > nowSeconds ? args.startTimestamp : undefined;
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

function buildSponsoredAutodepositSetupConfirmBody(args: {
  preparedSetup: SmartAccountPreparedEarnUsdcAutodepositSetup;
  setupTransaction: string;
}): EarnSponsoredAutodepositSetupConfirmRequestBody {
  const body = buildEarnAutodepositSetupConfirmRequestBody({
    confirmedSlot: "0",
    preparedSetup: args.preparedSetup,
    signature: "sponsored-autodeposit-setup-signature-placeholder",
    walletBalanceFloorRaw: WALLET_BALANCE_FLOOR_RAW,
  }) as Partial<
    ReturnType<typeof buildEarnAutodepositSetupConfirmRequestBody>
  > as EarnSponsoredAutodepositSetupConfirmRequestBody & {
    confirmedSlot?: string;
    setupSignature?: string;
  };
  delete body.confirmedSlot;
  delete body.setupSignature;
  body.setupTransaction = args.setupTransaction;
  return body;
}

async function postSponsoredEarnAutodepositSetup(args: {
  connection: Connection;
  preparedSetup: SmartAccountPreparedEarnUsdcAutodepositSetup;
  session: FrontendSession;
  sponsorFeePayer: PublicKey;
  wallet: ReturnType<typeof createKeypairWallet>;
}): Promise<SponsoredAutodepositSetupConfirmResponse> {
  const setupTransaction = await signPreparedEarnOperationForSponsorship({
    connection: args.connection,
    feePayer: args.sponsorFeePayer,
    operation: `sponsored Autodeposit setup ${args.preparedSetup.stage}`,
    prepared: args.preparedSetup.prepared,
    wallet: args.wallet,
  });
  const response =
    await frontendPostJson<SponsoredAutodepositSetupConfirmResponse>({
      body: buildSponsoredAutodepositSetupConfirmBody({
        preparedSetup: args.preparedSetup,
        setupTransaction,
      }),
      cookie: args.session.cookie,
      path: "/api/smart-accounts/yield-optimization/autodeposit/setup/confirm/sponsored",
      session: args.session,
    });
  if (!response.body.sponsoredConfirmations) {
    throw new Error(
      "Sponsored Autodeposit setup response is missing confirmations."
    );
  }

  return response.body;
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

function setupInput(args: {
  amountRaw: bigint;
  cluster: LoyalCluster;
  feePayer: PublicKey;
  policySeed?: bigint;
  policySigner: PublicKey;
  settingsPda: PublicKey;
  signer: PublicKey;
  startTimestamp?: bigint;
  walletAddress: PublicKey;
}) {
  return {
    amountRaw: args.amountRaw,
    cluster: args.cluster,
    expiryTimestamp: EXPIRY_TIMESTAMP,
    feePayer: args.feePayer,
    minimumDelegatorBalanceRaw: WALLET_BALANCE_FLOOR_RAW,
    nonce: NONCE,
    periodLengthSeconds: PERIOD_LENGTH_SECONDS,
    policySeed: args.policySeed,
    policySigner: args.policySigner,
    settingsPda: args.settingsPda,
    signer: args.signer,
    startTimestamp: args.startTimestamp,
    walletAddress: args.walletAddress,
  };
}

async function main() {
  assertMainnet();

  const connection = new Connection(RPC_URL, "confirmed");
  const wallet = loadTestingKeypair();
  const walletBridge = createKeypairWallet(wallet);
  const policySigner = loadDeploymentPolicySignerPublicKey();
  const sponsorFeePayer = loadSponsorFeePayer();
  const session = await authenticateFrontendSession({
    baseUrl: FRONTEND_BASE_URL,
    keypair: wallet,
    sessionCookie: FRONTEND_SESSION_COOKIE,
    turnstileToken: FRONTEND_TURNSTILE_TOKEN,
  });
  const settingsPda = new PublicKey(session.settingsPda);
  const cluster = resolveLoyalClusterForSolanaEnv(SOLANA_ENV);
  const client = createSmartAccountVaultsClient({
    connection,
    programId: PROGRAM_ID,
  });
  const requestedStartTimestamp = getRequestedStartTimestamp({
    expiryTimestamp: EXPIRY_TIMESTAMP,
    startTimestamp: START_TIMESTAMP,
  });
  const evidence: {
    config: Record<string, unknown>;
    steps: Record<string, EvidenceStep>;
  } = {
    config: {
      amountRaw: AMOUNT_RAW.toString(),
      cluster,
      frontendBaseUrl: FRONTEND_BASE_URL,
      nonce: NONCE.toString(),
      periodLengthSeconds: PERIOD_LENGTH_SECONDS?.toString() ?? null,
      policySigner: policySigner.toBase58(),
      programId: PROGRAM_ID.toBase58(),
      requestedPolicySeed: REQUESTED_POLICY_SEED?.toString() ?? null,
      requestedStartTimestamp: requestedStartTimestamp?.toString() ?? null,
      settingsPda: settingsPda.toBase58(),
      smartAccountAddress: session.smartAccountAddress,
      solanaEnv: SOLANA_ENV,
      sponsorFeePayer: sponsorFeePayer.toBase58(),
      walletAddress: wallet.publicKey.toBase58(),
      walletBalanceFloorRaw: WALLET_BALANCE_FLOOR_RAW.toString(),
    },
    steps: {},
  };

  let preparedSetup = await client.prepareEarnUsdcAutodepositSetup(
    setupInput({
      amountRaw: AMOUNT_RAW,
      cluster,
      feePayer: sponsorFeePayer,
      policySeed: REQUESTED_POLICY_SEED,
      policySigner,
      settingsPda,
      signer: wallet.publicKey,
      startTimestamp: requestedStartTimestamp,
      walletAddress: wallet.publicKey,
    })
  );
  evidence.steps.initialPrepare = {
    amountRaw: AMOUNT_RAW.toString(),
    instructionCount: preparedSetup.prepared.instructions.length,
    nativeSolRequirement: preparedSetup.nativeSolRequirement,
    persistence: preparedSetup.persistence,
    stage: preparedSetup.stage,
    status: "success",
  };

  let finalSetup: SmartAccountPreparedEarnUsdcAutodepositSetup | null = null;
  const setupConfirmations: EvidenceStep[] = [];
  let setupIteration = 0;

  while (!finalSetup) {
    setupIteration += 1;
    if (setupIteration > 4) {
      throw new Error("Autodeposit setup did not complete within 4 stages.");
    }

    validatePreparedCluster({
      cluster,
      operation: `autodeposit setup ${preparedSetup.stage}`,
      preparedCluster: preparedSetup.persistence.cluster,
    });

    const response = await postSponsoredEarnAutodepositSetup({
      connection,
      preparedSetup,
      session,
      sponsorFeePayer,
      wallet: walletBridge,
    });
    setupConfirmations.push({
      backend: response,
      confirmedSlot: response.sponsoredConfirmations?.setup.confirmedSlot,
      endpoint:
        "/api/smart-accounts/yield-optimization/autodeposit/setup/confirm/sponsored",
      instructionCount: preparedSetup.prepared.instructions.length,
      persistence: preparedSetup.persistence,
      signature: response.sponsoredConfirmations?.setup.signature,
      sponsored: true,
      sponsoredConfirmations: response.sponsoredConfirmations,
      stage: preparedSetup.stage,
      status: "success",
    });

    if (preparedSetup.stage === "create_recurring_delegation") {
      finalSetup = preparedSetup;
      break;
    }

    if (preparedSetup.stage === "create_policy") {
      const nextSetups =
        await client.prepareEarnUsdcAutodepositSetupBatchFromPrepared({
          ...setupInput({
            amountRaw: AMOUNT_RAW,
            cluster,
            feePayer: sponsorFeePayer,
            policySeed: preparedSetup.policy.seed ?? REQUESTED_POLICY_SEED,
            policySigner,
            settingsPda,
            signer: wallet.publicKey,
            startTimestamp: requestedStartTimestamp,
            walletAddress: wallet.publicKey,
          }),
          expiryTimestamp: preparedSetup.subscription.expiryTimestamp,
          nonce: preparedSetup.subscription.nonce,
          periodLengthSeconds: preparedSetup.subscription.periodLengthSeconds,
          preparedSetup,
          refreshImmediateStartTimestamp: requestedStartTimestamp === undefined,
        });
      preparedSetup = nextSetups[1] ?? nextSetups[0] ?? preparedSetup;
    } else {
      preparedSetup = await client.prepareEarnUsdcAutodepositSetup({
        ...setupInput({
          amountRaw: AMOUNT_RAW,
          cluster,
          feePayer: sponsorFeePayer,
          policySeed: preparedSetup.policy.seed ?? REQUESTED_POLICY_SEED,
          policySigner,
          settingsPda,
          signer: wallet.publicKey,
          startTimestamp: requestedStartTimestamp,
          walletAddress: wallet.publicKey,
        }),
        expiryTimestamp:
          EXPIRY_TIMESTAMP ?? preparedSetup.subscription.expiryTimestamp,
        nonce: preparedSetup.subscription.nonce,
        periodLengthSeconds:
          PERIOD_LENGTH_SECONDS ??
          preparedSetup.subscription.periodLengthSeconds,
      });
    }
  }

  evidence.steps.setupConfirmations = {
    backend: setupConfirmations,
    endpoint: "autodeposit setup confirm endpoints",
    status: "success",
  };
  evidence.steps.postSetupEarnState = {
    backend: await fetchEarnState({ session }),
    status: "success",
  };

  if (!finalSetup.policy.account) {
    throw new Error("Completed Autodeposit setup is missing policy account.");
  }

  const postSetupPolicy = await waitForAccountStatus({
    connection,
    exists: true,
    pubkey: finalSetup.persistence.policyAccount,
  });
  const postSetupRecurringDelegation = await waitForAccountStatus({
    connection,
    exists: true,
    pubkey: finalSetup.persistence.recurringDelegation,
  });
  evidence.steps.postSetupAccounts = {
    accounts: {
      policy: postSetupPolicy,
      recurringDelegation: postSetupRecurringDelegation,
      subscriptionAuthority: await accountStatus(
        connection,
        finalSetup.persistence.subscriptionAuthority
      ),
    },
    status: "success",
  };

  const preparedClose = await client.prepareEarnUsdcAutodepositClose({
    cluster,
    feePayer: sponsorFeePayer,
    policy: finalSetup.policy.account,
    policySigner,
    recurringDelegation: finalSetup.subscription.recurringDelegation,
    rentPayer: sponsorFeePayer,
    settingsPda,
    signer: wallet.publicKey,
    walletAddress: wallet.publicKey,
  });
  validatePreparedCluster({
    cluster,
    operation: "autodeposit close",
    preparedCluster: preparedClose.persistence.cluster,
  });

  const closeTransaction = await signPreparedEarnOperationForSponsorship({
    connection,
    feePayer: sponsorFeePayer,
    operation: "sponsored Autodeposit close",
    prepared: preparedClose.prepared,
    wallet: walletBridge,
  });
  const closeResponse = await postSponsoredEarnAutodepositClose({
    closeTransaction,
    preparedClose,
    session,
  });
  evidence.steps.closeConfirm = {
    backend: closeResponse,
    confirmedSlot: closeResponse.sponsoredConfirmations?.close.confirmedSlot,
    endpoint:
      "/api/smart-accounts/yield-optimization/autodeposit/close/confirm/sponsored",
    instructionCount: preparedClose.prepared.instructions.length,
    persistence: preparedClose.persistence,
    signature: closeResponse.sponsoredConfirmations?.close.signature,
    sponsored: true,
    sponsoredConfirmations: closeResponse.sponsoredConfirmations,
    status: "success",
  };

  evidence.steps.postCloseEarnState = {
    backend: await fetchEarnState({ session }),
    status: "success",
  };

  const postClosePolicy = await waitForAccountStatus({
    connection,
    exists: false,
    pubkey: finalSetup.persistence.policyAccount,
  });
  const postCloseRecurringDelegation = await waitForAccountStatus({
    connection,
    exists: false,
    pubkey: finalSetup.persistence.recurringDelegation,
  });
  evidence.steps.postCloseAccounts = {
    accounts: {
      policy: postClosePolicy,
      recurringDelegation: postCloseRecurringDelegation,
      subscriptionAuthority: await accountStatus(
        connection,
        finalSetup.persistence.subscriptionAuthority
      ),
    },
    note:
      postCloseRecurringDelegation?.exists === true
        ? "Sponsored zero-SOL close removes the smart-account policy; the Subscriptions delegation may remain rent-funded but inert because the vault can no longer sign through the removed policy."
        : undefined,
    status: postClosePolicy?.exists ? "failed" : "success",
  };

  if (postClosePolicy?.exists) {
    throw new Error("Autodeposit close did not remove the policy.");
  }

  console.log("[earn-autodeposit-mainnet-sponsored] PASS");
  console.log(JSON.stringify(evidence, bigintJson, 2));
}

main().catch((error) => {
  console.error("[earn-autodeposit-mainnet-sponsored] FAIL", error);
  process.exit(1);
});
