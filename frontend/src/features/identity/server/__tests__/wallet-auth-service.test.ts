import { beforeAll, beforeEach, describe, expect, mock, test } from "bun:test";
import bs58 from "bs58";

mock.module("server-only", () => ({}));

let createWalletAuthChallenge: typeof import("../wallet-auth-service").createWalletAuthChallenge;
let completeWalletAuth: typeof import("../wallet-auth-service").completeWalletAuth;

const baseConfig = {
  authAppName: "askloyal",
  authJwtSecret: "test-wallet-auth-secret",
  solanaEnv: "devnet" as const,
};

const smartAccountSummary = {
  programId: "program-1",
  settingsPda: "settings-1",
  smartAccountAddress: "smart-account-1",
  creationSignature: "sig-created",
};

const issueSessionToken = mock(async () => "session-token");
const getOrCreateUser = mock(async () => ({
  id: "user-1",
  provider: "solana" as const,
  subjectAddress: "wallet-1",
}));
const ensureSmartAccount = mock(async () => ({
  smartAccount: smartAccountSummary,
  provisioningOutcome: "sponsored_new_record" as const,
}));
const findReadySmartAccount = mock(async () => smartAccountSummary);
const beginCompletion = mock(async (input: { processingToken: string }) => ({
  kind: "owned" as const,
  record: {
    id: "completion-1",
    challengeHash: "hash-1",
    walletAddress: "wallet-1",
    solanaEnv: "devnet" as const,
    state: "processing" as const,
    processingToken: input.processingToken,
    processingStartedAt: new Date("2099-03-11T12:00:00.000Z"),
    userId: null,
    smartAccountAddress: null,
    provisioningOutcome: null,
    lastErrorCode: null,
    lastErrorMessage: null,
    completedAt: null,
    createdAt: new Date("2099-03-11T12:00:00.000Z"),
    updatedAt: new Date("2099-03-11T12:00:00.000Z"),
  },
}));
const findCompletionByChallengeHash = mock(async () => null);
const markCompletionCompleted = mock(async (input: {
  userId: string;
  smartAccountAddress: string;
  provisioningOutcome: string;
}) => ({
  id: "completion-1",
  challengeHash: "hash-1",
  walletAddress: "wallet-1",
  solanaEnv: "devnet" as const,
  state: "completed" as const,
  processingToken: null,
  processingStartedAt: null,
  userId: input.userId,
  smartAccountAddress: input.smartAccountAddress,
  provisioningOutcome: input.provisioningOutcome,
  lastErrorCode: null,
  lastErrorMessage: null,
  completedAt: new Date("2099-03-11T12:00:01.000Z"),
  createdAt: new Date("2099-03-11T12:00:00.000Z"),
  updatedAt: new Date("2099-03-11T12:00:01.000Z"),
}));
const markCompletionFailed = mock(async () => ({
  id: "completion-1",
  challengeHash: "hash-1",
  walletAddress: "wallet-1",
  solanaEnv: "devnet" as const,
  state: "failed" as const,
  processingToken: null,
  processingStartedAt: null,
  userId: "user-1",
  smartAccountAddress: null,
  provisioningOutcome: null,
  lastErrorCode: "wallet_onboarding_failed",
  lastErrorMessage: "Wallet onboarding failed",
  completedAt: new Date("2099-03-11T12:00:01.000Z"),
  createdAt: new Date("2099-03-11T12:00:00.000Z"),
  updatedAt: new Date("2099-03-11T12:00:01.000Z"),
}));
const trackEvent = mock(() => {});
const wait = mock(async () => {});

function createDependencies(overrides: Record<string, unknown> = {}) {
  let uuidCalls = 0;

  return {
    getConfig: () => baseConfig,
    issueSessionToken,
    now: () => new Date("2099-03-11T12:00:00.000Z"),
    randomUUID: () => {
      uuidCalls += 1;
      return uuidCalls === 1 ? "nonce-123" : "processing-123";
    },
    wait,
    getOrCreateUser,
    ensureSmartAccount,
    findReadySmartAccount,
    beginCompletion,
    findCompletionByChallengeHash,
    markCompletionCompleted,
    markCompletionFailed,
    trackEvent,
    ...overrides,
  };
}

async function createWalletKeypair() {
  const keyPair = await crypto.subtle.generateKey("Ed25519", true, [
    "sign",
    "verify",
  ]);
  const publicKeyBytes = new Uint8Array(
    await crypto.subtle.exportKey("raw", keyPair.publicKey)
  );

  return {
    keyPair,
    walletAddress: bs58.encode(publicKeyBytes),
  };
}

async function signWalletMessage(args: {
  keyPair: CryptoKeyPair;
  message: string;
}) {
  const signatureBytes = new Uint8Array(
    await crypto.subtle.sign(
      "Ed25519",
      args.keyPair.privateKey,
      new TextEncoder().encode(args.message)
    )
  );

  return bs58.encode(signatureBytes);
}

describe("wallet auth service", () => {
  beforeAll(async () => {
    ({ createWalletAuthChallenge, completeWalletAuth } = await import(
      "../wallet-auth-service"
    ));
  });

  beforeEach(() => {
    issueSessionToken.mockClear();
    getOrCreateUser.mockClear();
    ensureSmartAccount.mockClear();
    findReadySmartAccount.mockClear();
    beginCompletion.mockClear();
    findCompletionByChallengeHash.mockClear();
    markCompletionCompleted.mockClear();
    markCompletionFailed.mockClear();
    trackEvent.mockClear();
    wait.mockClear();
  });

  test("verifies a wallet signature and returns a session user with a smart account", async () => {
    const signer = await createWalletKeypair();
    getOrCreateUser.mockImplementationOnce(async () => ({
      id: "user-1",
      provider: "solana" as const,
      subjectAddress: signer.walletAddress,
    }));
    const challenge = await createWalletAuthChallenge(
      {
        walletAddress: signer.walletAddress,
      },
      {
        requestOrigin: "https://app.askloyal.com",
      },
      createDependencies() as never
    );
    const signature = await signWalletMessage({
      keyPair: signer.keyPair,
      message: challenge.message,
    });

    const result = await completeWalletAuth(
      {
        challengeToken: challenge.challengeToken,
        signature,
      },
      {
        requestOrigin: "https://app.askloyal.com",
      },
      createDependencies() as never
    );

    expect(result).toEqual({
      user: {
        authMethod: "wallet",
        subjectAddress: signer.walletAddress,
        displayAddress: signer.walletAddress,
        walletAddress: signer.walletAddress,
        provider: "solana",
        smartAccountAddress: "smart-account-1",
        settingsPda: "settings-1",
      },
      smartAccount: smartAccountSummary,
      sessionClaims: {
        authMethod: "wallet",
        subjectAddress: signer.walletAddress,
        displayAddress: signer.walletAddress,
        provider: "solana",
        walletAddress: signer.walletAddress,
        smartAccountAddress: "smart-account-1",
        settingsPda: "settings-1",
      },
      provisioningOutcome: "sponsored_new_record",
      sessionToken: "session-token",
    });
    expect(getOrCreateUser).toHaveBeenCalledWith({
      provider: "solana",
      authMethod: "wallet",
      subjectAddress: signer.walletAddress,
      walletAddress: signer.walletAddress,
    });
    expect(ensureSmartAccount).toHaveBeenCalledWith({
      userId: "user-1",
      walletAddress: signer.walletAddress,
    });
    expect(markCompletionCompleted).toHaveBeenCalledTimes(1);
    const [completionArgs, completionDependencies] =
      markCompletionCompleted.mock.calls[0] ?? [];
    expect(completionArgs).toMatchObject({
      processingToken: "nonce-123",
      userId: "user-1",
      smartAccountAddress: "smart-account-1",
      provisioningOutcome: "sponsored_new_record",
    });
    expect(typeof completionArgs.challengeHash).toBe("string");
    expect(completionDependencies).toMatchObject({
      now: expect.any(Function),
    });
    expect(issueSessionToken).toHaveBeenCalledWith(result.user);
    expect(trackEvent).toHaveBeenCalledWith("sponsorship_submitted", {
      origin: "https://app.askloyal.com",
      walletAddress: signer.walletAddress,
      solanaEnv: "devnet",
      provisioningOutcome: "sponsored_new_record",
      smartAccountAddress: "smart-account-1",
    });
  });

  test("rejects invalid wallet signatures", async () => {
    const signer = await createWalletKeypair();
    const challenge = await createWalletAuthChallenge(
      {
        walletAddress: signer.walletAddress,
      },
      {
        requestOrigin: "https://app.askloyal.com",
      },
      createDependencies() as never
    );
    const otherSigner = await createWalletKeypair();
    const signature = await signWalletMessage({
      keyPair: otherSigner.keyPair,
      message: challenge.message,
    });

    await expect(
      completeWalletAuth(
        {
          challengeToken: challenge.challengeToken,
          signature,
        },
        {
          requestOrigin: "https://app.askloyal.com",
        },
        createDependencies() as never
      )
    ).rejects.toMatchObject({
      name: "WalletAuthError",
      code: "invalid_wallet_signature",
      status: 401,
    });

    expect(trackEvent).toHaveBeenCalledWith("invalid_signature", {
      origin: "https://app.askloyal.com",
      walletAddress: signer.walletAddress,
      solanaEnv: "devnet",
    });
  });

  test("rejects wallet completion when the challenge origin changes", async () => {
    const signer = await createWalletKeypair();
    const challenge = await createWalletAuthChallenge(
      {
        walletAddress: signer.walletAddress,
      },
      {
        requestOrigin: "https://app.askloyal.com",
      },
      createDependencies() as never
    );
    const signature = await signWalletMessage({
      keyPair: signer.keyPair,
      message: challenge.message,
    });

    await expect(
      completeWalletAuth(
        {
          challengeToken: challenge.challengeToken,
          signature,
        },
        {
          requestOrigin: "https://evil.askloyal.com",
        },
        createDependencies() as never
      )
    ).rejects.toMatchObject({
      name: "WalletAuthError",
      code: "invalid_wallet_origin",
      status: 403,
    });
  });

  test("replays an already completed wallet onboarding attempt without re-sponsoring", async () => {
    const signer = await createWalletKeypair();
    const challenge = await createWalletAuthChallenge(
      {
        walletAddress: signer.walletAddress,
      },
      {
        requestOrigin: "https://app.askloyal.com",
      },
      createDependencies() as never
    );
    const signature = await signWalletMessage({
      keyPair: signer.keyPair,
      message: challenge.message,
    });

    const result = await completeWalletAuth(
      {
        challengeToken: challenge.challengeToken,
        signature,
      },
      {
        requestOrigin: "https://app.askloyal.com",
      },
      createDependencies({
        beginCompletion: mock(async () => ({
          kind: "completed" as const,
          record: {
            id: "completion-1",
            challengeHash: "hash-1",
            walletAddress: signer.walletAddress,
            solanaEnv: "devnet" as const,
            state: "completed" as const,
            processingToken: null,
            processingStartedAt: null,
            userId: "user-1",
            smartAccountAddress: "smart-account-1",
            provisioningOutcome: "existing_ready" as const,
            lastErrorCode: null,
            lastErrorMessage: null,
            completedAt: new Date("2099-03-11T12:00:01.000Z"),
            createdAt: new Date("2099-03-11T12:00:00.000Z"),
            updatedAt: new Date("2099-03-11T12:00:01.000Z"),
          },
        })),
      }) as never
    );

    expect(result.provisioningOutcome).toBe("existing_ready");
    expect(ensureSmartAccount).not.toHaveBeenCalled();
    expect(markCompletionCompleted).not.toHaveBeenCalled();
    expect(findReadySmartAccount).toHaveBeenCalledWith({
      userId: "user-1",
    });
  });

  test("waits for an in-flight completion and replays the finished result", async () => {
    const signer = await createWalletKeypair();
    const challenge = await createWalletAuthChallenge(
      {
        walletAddress: signer.walletAddress,
      },
      {
        requestOrigin: "https://app.askloyal.com",
      },
      createDependencies() as never
    );
    const signature = await signWalletMessage({
      keyPair: signer.keyPair,
      message: challenge.message,
    });

    const queuedRecords = [
      {
        id: "completion-1",
        challengeHash: "hash-1",
        walletAddress: signer.walletAddress,
        solanaEnv: "devnet" as const,
        state: "processing" as const,
        processingToken: "processing-other",
        processingStartedAt: new Date("2099-03-11T12:00:00.000Z"),
        userId: null,
        smartAccountAddress: null,
        provisioningOutcome: null,
        lastErrorCode: null,
        lastErrorMessage: null,
        completedAt: null,
        createdAt: new Date("2099-03-11T12:00:00.000Z"),
        updatedAt: new Date("2099-03-11T12:00:00.000Z"),
      },
      {
        id: "completion-1",
        challengeHash: "hash-1",
        walletAddress: signer.walletAddress,
        solanaEnv: "devnet" as const,
        state: "completed" as const,
        processingToken: null,
        processingStartedAt: null,
        userId: "user-1",
        smartAccountAddress: "smart-account-1",
        provisioningOutcome: "reconciled_ready" as const,
        lastErrorCode: null,
        lastErrorMessage: null,
        completedAt: new Date("2099-03-11T12:00:01.000Z"),
        createdAt: new Date("2099-03-11T12:00:00.000Z"),
        updatedAt: new Date("2099-03-11T12:00:01.000Z"),
      },
    ];

    const result = await completeWalletAuth(
      {
        challengeToken: challenge.challengeToken,
        signature,
      },
      {
        requestOrigin: "https://app.askloyal.com",
      },
      createDependencies({
        beginCompletion: mock(async () => ({
          kind: "in_progress" as const,
          record: queuedRecords[0],
        })),
        findCompletionByChallengeHash: mock(async () => queuedRecords.shift() ?? null),
      }) as never
    );

    expect(result.provisioningOutcome).toBe("reconciled_ready");
    expect(wait).toHaveBeenCalled();
    expect(ensureSmartAccount).not.toHaveBeenCalled();
    expect(markCompletionCompleted).not.toHaveBeenCalled();
  });
});
