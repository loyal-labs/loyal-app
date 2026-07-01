import "server-only";

import { createHash } from "node:crypto";

import {
  buildWalletAuthTransactionMemo,
  createAuthSessionTokenClaims,
  WALLET_AUTH_SIWS_STATEMENT,
  type AuthSessionTokenClaimsData,
  type AuthSessionUser,
  type WalletChallengeResponse,
  walletChallengeRequestSchema,
  walletCompleteRequestSchema,
} from "@loyal-labs/auth-core";
import type { SolanaEnv } from "@loyal-labs/solana-rpc";
import { Connection } from "@solana/web3.js";

import type { AppUser } from "@/features/chat/server/app-user";
import { getOrCreateCurrentUser } from "@/features/chat/server/app-user";
import {
  beginWalletAuthCompletion,
  findWalletAuthCompletionByChallengeHash,
  markWalletAuthCompletionCompleted,
  markWalletAuthCompletionFailed,
  type WalletAuthCompletionLease,
  type WalletAuthCompletionRecord,
} from "@/features/identity/server/wallet-auth-completion-repository";
import { createAuthSessionCookieService } from "@/features/identity/server/session-cookie";
import {
  isSmartAccountProvisioningError,
  type EnsureUserSmartAccountResult,
  type SmartAccountSummary,
} from "@/features/smart-accounts/server/service";
import {
  ensureWalletUserSmartAccount,
  findReadyCurrentUserSmartAccount,
} from "@/features/smart-accounts/server/service";
import { getServerEnv } from "@/lib/core/config/server";
import { getServerSolanaEndpoints } from "@/lib/solana/rpc-endpoints.server";

import { trackWalletOnboardingEvent } from "./wallet-onboarding-analytics";
import { WalletAuthError } from "./wallet-auth-errors";
import { buildWalletAuthMessage } from "./wallet-auth-message";
import {
  createWalletAuthSignInInput,
  verifyWalletSignInOutput,
} from "./wallet-auth-siws";
import {
  decodeWalletAddress,
  verifyWalletSignature,
} from "./wallet-auth-signature";
import {
  createWalletAuthTransactionChallenge,
  verifyWalletAuthTransactionProof,
} from "./wallet-auth-transaction";
import {
  issueWalletChallengeToken,
  verifyWalletChallengeToken,
} from "./wallet-auth-tokens";

export const WALLET_CHALLENGE_TTL_SECONDS = 60 * 10;
const WALLET_AUTH_COMPLETION_STALE_MS = 30_000;
const WALLET_AUTH_COMPLETION_WAIT_TIMEOUT_MS = 5_000;
const WALLET_AUTH_COMPLETION_WAIT_INTERVAL_MS = 100;

type WalletOnboardingDependencies = {
  getConfig: typeof getServerEnv;
  issueSessionToken: (user: AuthSessionUser) => Promise<string>;
  now: () => Date;
  randomUUID: () => string;
  wait: (ms: number) => Promise<void>;
  getLatestBlockhash: (solanaEnv: SolanaEnv) => Promise<string>;
  getOrCreateUser: (principal: {
    provider: "solana";
    authMethod: "wallet";
    subjectAddress: string;
    walletAddress: string;
  }) => Promise<AppUser>;
  ensureSmartAccount: (input: {
    userId: string;
    walletAddress: string;
  }) => Promise<EnsureUserSmartAccountResult>;
  findReadySmartAccount: (input: {
    userId: string;
  }) => Promise<SmartAccountSummary | null>;
  beginCompletion: typeof beginWalletAuthCompletion;
  findCompletionByChallengeHash: typeof findWalletAuthCompletionByChallengeHash;
  markCompletionCompleted: typeof markWalletAuthCompletionCompleted;
  markCompletionFailed: typeof markWalletAuthCompletionFailed;
  trackEvent: typeof trackWalletOnboardingEvent;
};

export type WalletOnboardingResult = {
  user: AuthSessionUser;
  smartAccount: SmartAccountSummary;
  sessionClaims: AuthSessionTokenClaimsData;
  provisioningOutcome: EnsureUserSmartAccountResult["provisioningOutcome"];
  sessionToken: string;
};

const defaultDependencies: WalletOnboardingDependencies = {
  getConfig: () => getServerEnv(),
  issueSessionToken: (user) =>
    createAuthSessionCookieService({
      getConfig: () => getServerEnv(),
    }).issueSessionToken(user),
  now: () => new Date(),
  randomUUID: () => crypto.randomUUID(),
  wait: async (ms) => {
    await new Promise((resolve) => setTimeout(resolve, ms));
  },
  getLatestBlockhash: async (solanaEnv) => {
    const { rpcEndpoint } = getServerSolanaEndpoints(solanaEnv);
    const connection = new Connection(rpcEndpoint, {
      commitment: "confirmed",
    });
    const { blockhash } = await connection.getLatestBlockhash("confirmed");
    return blockhash;
  },
  getOrCreateUser: (principal) => getOrCreateCurrentUser(principal),
  ensureSmartAccount: ensureWalletUserSmartAccount,
  findReadySmartAccount: findReadyCurrentUserSmartAccount,
  beginCompletion: beginWalletAuthCompletion,
  findCompletionByChallengeHash: findWalletAuthCompletionByChallengeHash,
  markCompletionCompleted: markWalletAuthCompletionCompleted,
  markCompletionFailed: markWalletAuthCompletionFailed,
  trackEvent: trackWalletOnboardingEvent,
};

function getWalletAuthSecret(config: ReturnType<typeof getServerEnv>): string {
  if (!config.authJwtSecret) {
    throw new Error("AUTH_JWT_SECRET is not set");
  }

  return config.authJwtSecret;
}

function hashChallengeToken(challengeToken: string): string {
  return createHash("sha256").update(challengeToken).digest("hex");
}

function createSiwsNonce(randomId: string): string {
  const normalized = randomId.replace(/[^A-Za-z0-9]/g, "");
  if (normalized.length >= 8) {
    return normalized;
  }

  return createHash("sha256").update(randomId).digest("hex");
}

function buildWalletSessionUser(args: {
  walletAddress: string;
  smartAccountAddress: string;
  settingsPda: string;
}): AuthSessionUser {
  return {
    authMethod: "wallet",
    walletAddress: args.walletAddress,
    subjectAddress: args.walletAddress,
    displayAddress: args.walletAddress,
    provider: "solana",
    smartAccountAddress: args.smartAccountAddress,
    settingsPda: args.settingsPda,
  };
}

function toReplayFailure(record: WalletAuthCompletionRecord): WalletAuthError {
  return new WalletAuthError(
    record.lastErrorMessage ?? "Wallet onboarding could not be completed.",
    {
      code: record.lastErrorCode ?? "wallet_onboarding_failed",
      status:
        record.lastErrorCode === "smart_account_reservation_conflict"
          ? 409
          : 502,
    }
  );
}

function classifyProvisioningOutcome(
  provisioningOutcome: EnsureUserSmartAccountResult["provisioningOutcome"]
):
  | "existing_smart_account_reused"
  | "delegated_smart_account_reused"
  | "sponsorship_submitted"
  | "reconciliation_succeeded" {
  if (provisioningOutcome === "existing_ready") {
    return "existing_smart_account_reused";
  }

  if (provisioningOutcome === "delegated_root_signer") {
    return "delegated_smart_account_reused";
  }

  if (provisioningOutcome === "reconciled_ready") {
    return "reconciliation_succeeded";
  }

  return "sponsorship_submitted";
}

async function replayCompletedOnboarding(args: {
  record: WalletAuthCompletionRecord;
  dependencies: WalletOnboardingDependencies;
}): Promise<WalletOnboardingResult> {
  if (!args.record.userId || !args.record.smartAccountAddress) {
    throw new Error("Wallet auth completion record is missing replay data");
  }

  const config = args.dependencies.getConfig();
  const smartAccount = args.record.settingsPda
    ? {
        creationSignature: null,
        programId: config.loyalSmartAccounts.programId,
        settingsPda: args.record.settingsPda,
        smartAccountAddress: args.record.smartAccountAddress,
      }
    : await args.dependencies.findReadySmartAccount({
        userId: args.record.userId,
      });
  if (!smartAccount) {
    throw new Error(
      "Wallet auth completion replay could not find a ready smart account"
    );
  }

  const user = buildWalletSessionUser({
    walletAddress: args.record.walletAddress,
    smartAccountAddress: smartAccount.smartAccountAddress,
    settingsPda: smartAccount.settingsPda,
  });
  const sessionClaims = createAuthSessionTokenClaims(user);

  return {
    user,
    smartAccount,
    sessionClaims,
    provisioningOutcome: args.record.provisioningOutcome ?? "existing_ready",
    sessionToken: await args.dependencies.issueSessionToken(user),
  };
}

async function awaitWalletAuthCompletion(args: {
  challengeHash: string;
  dependencies: WalletOnboardingDependencies;
  timeoutMs: number;
}): Promise<WalletAuthCompletionLease> {
  const startedAt = args.dependencies.now().getTime();

  while (args.dependencies.now().getTime() - startedAt < args.timeoutMs) {
    const record = await args.dependencies.findCompletionByChallengeHash(
      args.challengeHash
    );

    if (record?.state === "completed") {
      return {
        kind: "completed",
        record,
      };
    }

    if (record?.state === "failed") {
      return {
        kind: "failed",
        record,
      };
    }

    await args.dependencies.wait(WALLET_AUTH_COMPLETION_WAIT_INTERVAL_MS);
  }

  const record = await args.dependencies.findCompletionByChallengeHash(
    args.challengeHash
  );

  if (!record) {
    throw new Error("Wallet auth completion record disappeared during polling");
  }

  return {
    kind: record.state === "processing" ? "in_progress" : "failed",
    record,
  };
}

export async function createWalletAuthChallenge(
  input: unknown,
  args: {
    requestOrigin: string;
  },
  dependencies: WalletOnboardingDependencies = defaultDependencies
): Promise<WalletChallengeResponse> {
  const payload = walletChallengeRequestSchema.parse(input);
  const config = dependencies.getConfig();
  const secret = getWalletAuthSecret(config);

  const issuedAt = dependencies.now();
  const expiresAt = new Date(
    issuedAt.getTime() + WALLET_CHALLENGE_TTL_SECONDS * 1000
  );
  if (payload.kind === "siws") {
    const signInInput = createWalletAuthSignInInput({
      expiresAt,
      issuedAt,
      nonce: createSiwsNonce(dependencies.randomUUID()),
      origin: args.requestOrigin,
      solanaEnv: config.solanaEnv,
      statement: WALLET_AUTH_SIWS_STATEMENT,
    });
    const challengeToken = await issueWalletChallengeToken(
      {
        tokenType: "wallet_challenge",
        version: 1,
        proofKind: "siws",
        origin: args.requestOrigin,
        signInInput,
      },
      secret,
      {
        issuedAt,
        expiresAt,
      }
    );

    dependencies.trackEvent("challenge_created", {
      origin: args.requestOrigin,
      walletAddress: "siws_pending",
      solanaEnv: config.solanaEnv,
    });

    return {
      kind: "siws",
      challengeToken,
      signInInput,
      expiresAt: expiresAt.toISOString(),
    };
  }

  if (payload.kind === "transaction") {
    const walletAddress = payload.walletAddress;
    decodeWalletAddress(walletAddress);

    const memo = buildWalletAuthTransactionMemo({
      appName: config.authAppName,
      origin: args.requestOrigin,
      walletAddress,
      nonce: createSiwsNonce(dependencies.randomUUID()),
      issuedAt: issuedAt.toISOString(),
      expiresAt: expiresAt.toISOString(),
    });
    const transactionChallenge = createWalletAuthTransactionChallenge({
      memo,
      walletAddress,
    });
    const challengeToken = await issueWalletChallengeToken(
      {
        tokenType: "wallet_challenge",
        version: 1,
        proofKind: "transaction",
        origin: args.requestOrigin,
        walletAddress,
        memo: transactionChallenge.memo,
        transaction: transactionChallenge.transaction,
      },
      secret,
      {
        issuedAt,
        expiresAt,
      }
    );

    dependencies.trackEvent("challenge_created", {
      origin: args.requestOrigin,
      walletAddress,
      solanaEnv: config.solanaEnv,
    });

    return {
      kind: "transaction",
      challengeToken,
      transaction: transactionChallenge.transaction,
      expiresAt: expiresAt.toISOString(),
    };
  }

  const walletAddress = payload.walletAddress;
  decodeWalletAddress(walletAddress);

  const nonce = dependencies.randomUUID();
  const message = buildWalletAuthMessage({
    appName: config.authAppName,
    origin: args.requestOrigin,
    walletAddress,
    nonce,
    issuedAt: issuedAt.toISOString(),
    expiresAt: expiresAt.toISOString(),
  });
  const challengeToken = await issueWalletChallengeToken(
    {
      tokenType: "wallet_challenge",
      version: 1,
      proofKind: "message",
      origin: args.requestOrigin,
      walletAddress,
      message,
    },
    secret,
    {
      issuedAt,
      expiresAt,
    }
  );

  dependencies.trackEvent("challenge_created", {
    origin: args.requestOrigin,
    walletAddress,
    solanaEnv: config.solanaEnv,
  });

  return {
    kind: "message",
    challengeToken,
    message,
    expiresAt: expiresAt.toISOString(),
  };
}

export async function completeWalletOnboarding(
  input: unknown,
  args: {
    requestOrigin: string;
  },
  dependencies: WalletOnboardingDependencies = defaultDependencies
): Promise<WalletOnboardingResult> {
  const payload = walletCompleteRequestSchema.parse(input);
  const config = dependencies.getConfig();
  const claims = await verifyWalletChallengeToken(
    payload.challengeToken,
    getWalletAuthSecret(config)
  );

  if (claims.origin !== args.requestOrigin) {
    throw new WalletAuthError("Wallet challenge origin is invalid.", {
      code: "invalid_wallet_origin",
      status: 403,
      details: {
        expectedOrigin: claims.origin,
        receivedOrigin: args.requestOrigin,
      },
    });
  }

  if ((payload.kind ?? "message") !== claims.proofKind) {
    throw new WalletAuthError("Wallet challenge proof type is invalid.", {
      code: "invalid_wallet_proof_kind",
      status: 400,
    });
  }

  let walletAddress: string;

  if (claims.proofKind === "siws") {
    if (payload.kind !== "siws") {
      throw new WalletAuthError("Wallet sign-in payload is invalid.", {
        code: "invalid_wallet_signin_payload",
        status: 400,
      });
    }

    walletAddress = verifyWalletSignInOutput({
      input: claims.signInInput,
      output: payload.output,
    });
  } else if (claims.proofKind === "transaction") {
    if (payload.kind !== "transaction") {
      throw new WalletAuthError("Wallet transaction payload is invalid.", {
        code: "invalid_wallet_transaction_payload",
        status: 400,
      });
    }

    walletAddress = verifyWalletAuthTransactionProof({
      memo: claims.memo,
      signedTransaction: payload.signedTransaction,
      walletAddress: claims.walletAddress,
    });
  } else {
    if (payload.kind === "siws" || payload.kind === "transaction") {
      throw new WalletAuthError("Wallet signature payload is invalid.", {
        code: "invalid_wallet_signature_payload",
        status: 400,
      });
    }

    const isValid = await verifyWalletSignature({
      walletAddress: claims.walletAddress,
      message: claims.message,
      signature: payload.signature,
    });

    if (!isValid) {
      dependencies.trackEvent("invalid_signature", {
        origin: args.requestOrigin,
        walletAddress: claims.walletAddress,
        solanaEnv: config.solanaEnv,
      });
      throw new WalletAuthError("Wallet signature could not be verified.", {
        code: "invalid_wallet_signature",
        status: 401,
        details: {
          walletAddress: claims.walletAddress,
        },
      });
    }

    walletAddress = claims.walletAddress;
  }

  const challengeHash = hashChallengeToken(payload.challengeToken);
  const processingToken = dependencies.randomUUID();
  const lease = await dependencies.beginCompletion(
    {
      challengeHash,
      walletAddress,
      solanaEnv: config.solanaEnv,
      processingToken,
      staleBefore: new Date(
        dependencies.now().getTime() - WALLET_AUTH_COMPLETION_STALE_MS
      ),
    },
    {
      now: dependencies.now,
    }
  );

  if (lease.record.walletAddress !== walletAddress) {
    throw new WalletAuthError(
      "Wallet challenge was completed by another wallet.",
      {
        code: "wallet_challenge_wallet_mismatch",
        status: 409,
      }
    );
  }

  if (lease.kind === "completed") {
    return replayCompletedOnboarding({
      record: lease.record,
      dependencies,
    });
  }

  if (lease.kind === "failed") {
    dependencies.trackEvent("reconciliation_failed", {
      origin: args.requestOrigin,
      walletAddress,
      solanaEnv: config.solanaEnv,
      errorCode: lease.record.lastErrorCode ?? "wallet_onboarding_failed",
    });
    throw toReplayFailure(lease.record);
  }

  if (lease.kind === "in_progress") {
    const observedLease = await awaitWalletAuthCompletion({
      challengeHash,
      dependencies,
      timeoutMs: WALLET_AUTH_COMPLETION_WAIT_TIMEOUT_MS,
    });

    if (observedLease.kind === "completed") {
      return replayCompletedOnboarding({
        record: observedLease.record,
        dependencies,
      });
    }

    if (observedLease.kind === "failed") {
      dependencies.trackEvent("reconciliation_failed", {
        origin: args.requestOrigin,
        walletAddress,
        solanaEnv: config.solanaEnv,
        errorCode:
          observedLease.record.lastErrorCode ?? "wallet_onboarding_failed",
      });
      throw toReplayFailure(observedLease.record);
    }

    throw new WalletAuthError(
      "Wallet onboarding is already in progress. Please retry in a moment.",
      {
        code: "wallet_auth_completion_in_progress",
        status: 409,
      }
    );
  }

  const principal = {
    provider: "solana" as const,
    authMethod: "wallet" as const,
    subjectAddress: walletAddress,
    walletAddress,
  };

  let userRecord: AppUser | null = null;
  let completionCommitted = false;

  try {
    userRecord = await dependencies.getOrCreateUser(principal);
    const ensureResult = await dependencies.ensureSmartAccount({
      userId: userRecord.id,
      walletAddress,
    });

    const completedRecord = await dependencies.markCompletionCompleted(
      {
        challengeHash,
        processingToken,
        userId: userRecord.id,
        smartAccountAddress: ensureResult.smartAccount.smartAccountAddress,
        settingsPda: ensureResult.smartAccount.settingsPda,
        provisioningOutcome: ensureResult.provisioningOutcome,
      },
      {
        now: dependencies.now,
      }
    );
    completionCommitted = true;

    const user = buildWalletSessionUser({
      walletAddress,
      smartAccountAddress: completedRecord.smartAccountAddress!,
      settingsPda: ensureResult.smartAccount.settingsPda,
    });
    const sessionClaims = createAuthSessionTokenClaims(user);
    const eventType = classifyProvisioningOutcome(
      ensureResult.provisioningOutcome
    );
    if (eventType === "existing_smart_account_reused") {
      dependencies.trackEvent("existing_smart_account_reused", {
        origin: args.requestOrigin,
        walletAddress,
        solanaEnv: config.solanaEnv,
        provisioningOutcome: ensureResult.provisioningOutcome,
      });
    } else if (eventType === "delegated_smart_account_reused") {
      dependencies.trackEvent("existing_smart_account_reused", {
        origin: args.requestOrigin,
        walletAddress,
        solanaEnv: config.solanaEnv,
        provisioningOutcome: ensureResult.provisioningOutcome,
        smartAccountAddress: ensureResult.smartAccount.smartAccountAddress,
      });
    } else if (eventType === "reconciliation_succeeded") {
      dependencies.trackEvent("reconciliation_succeeded", {
        origin: args.requestOrigin,
        walletAddress,
        solanaEnv: config.solanaEnv,
        provisioningOutcome: ensureResult.provisioningOutcome,
      });
    } else {
      dependencies.trackEvent("sponsorship_submitted", {
        origin: args.requestOrigin,
        walletAddress,
        solanaEnv: config.solanaEnv,
        provisioningOutcome: ensureResult.provisioningOutcome,
        smartAccountAddress: ensureResult.smartAccount.smartAccountAddress,
      });
    }

    const sessionToken = await dependencies.issueSessionToken(user);

    return {
      user,
      smartAccount: ensureResult.smartAccount,
      sessionClaims,
      provisioningOutcome: ensureResult.provisioningOutcome,
      sessionToken,
    };
  } catch (error) {
    if (isSmartAccountProvisioningError(error)) {
      dependencies.trackEvent(
        error.code === "smart_account_reservation_conflict"
          ? "reservation_conflict"
          : "reconciliation_failed",
        {
          origin: args.requestOrigin,
          walletAddress,
          solanaEnv: config.solanaEnv,
          errorCode: error.code,
        }
      );
    }

    if (!completionCommitted) {
      try {
        await dependencies.markCompletionFailed(
          {
            challengeHash,
            processingToken,
            errorCode:
              error instanceof WalletAuthError
                ? error.code
                : isSmartAccountProvisioningError(error)
                ? error.code
                : "wallet_onboarding_failed",
            errorMessage:
              error instanceof Error
                ? error.message
                : "Wallet onboarding could not be completed.",
            ...(userRecord ? { userId: userRecord.id } : {}),
          },
          {
            now: dependencies.now,
          }
        );
      } catch (markFailedError) {
        console.error(
          "[wallet-onboarding] failed to persist completion failure",
          {
            challengeHash,
            walletAddress,
            error: markFailedError,
          }
        );
      }
    }

    throw error;
  }
}
