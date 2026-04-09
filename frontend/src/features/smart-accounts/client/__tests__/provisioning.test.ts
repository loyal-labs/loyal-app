import { beforeAll, beforeEach, describe, expect, mock, test } from "bun:test";
import type { Connection } from "@solana/web3.js";
import { Keypair } from "@solana/web3.js";

import {
  deriveCanonicalSmartAccountAddress,
  deriveSettingsPdaAddress,
} from "@/features/smart-accounts/derivation";

const permissionsAll = mock(() => ({ all: true }));
const prepareCreate = mock(async () => ({ operation: "create" }));
const clientSend = mock(async () => "sig-123");

mock.module("@loyal-labs/loyal-smart-accounts", () => ({
  codecs: {
    Permissions: {
      all: permissionsAll,
    },
  },
  smartAccounts: {
    prepare: {
      create: prepareCreate,
    },
  },
  createLoyalSmartAccountsClient: () => ({
    send: clientSend,
  }),
}));

let provisionSmartAccountForWalletSession: typeof import("../provisioning").provisionSmartAccountForWalletSession;
let shouldProvisionWalletSmartAccount: typeof import("../provisioning").shouldProvisionWalletSmartAccount;
let SmartAccountProvisioningNetworkMismatchError: typeof import("../send").SmartAccountProvisioningNetworkMismatchError;

const programId = "SMRTzfY6DfH5ik3TKiyLFfXexV8uSG3d2UksSCYdunG";
const pendingSettingsPda = deriveSettingsPdaAddress({
  programId,
  accountIndex: 12n,
});

const pendingResponse = {
  state: "pending" as const,
  solanaEnv: "devnet" as const,
  programId,
  settingsPda: pendingSettingsPda,
  smartAccountAddress: deriveCanonicalSmartAccountAddress({
    programId,
    settingsPda: pendingSettingsPda,
  }),
  creationSignature: null,
  treasury: Keypair.generate().publicKey.toBase58(),
};
const walletAddress = Keypair.generate().publicKey.toBase58();

const readyResponse = {
  ...pendingResponse,
  state: "ready" as const,
  treasury: null,
  creationSignature: "sig-123",
};

describe("smart-account client provisioning", () => {
  beforeAll(async () => {
    ({
      provisionSmartAccountForWalletSession,
      shouldProvisionWalletSmartAccount,
    } = await import("../provisioning"));
    ({ SmartAccountProvisioningNetworkMismatchError } = await import("../send"));
  });

  beforeEach(() => {
    permissionsAll.mockClear();
    prepareCreate.mockClear();
    clientSend.mockClear();
    clientSend.mockImplementation(async () => "sig-123");
  });

  test("detects when wallet provisioning should run", () => {
    expect(
      shouldProvisionWalletSmartAccount({
        isHydrated: true,
        user: {
          authMethod: "wallet",
          subjectAddress: walletAddress,
          displayAddress: walletAddress,
          walletAddress,
        },
        connected: true,
        walletAddress,
        hasSendTransaction: true,
      })
    ).toBe(true);
  });

  test("skips onchain creation when ensure already returns ready", async () => {
    const ensure = mock(async () => readyResponse);

    const response = await provisionSmartAccountForWalletSession({
      connection: {} as Connection,
      walletAddress,
      signTransaction: async (transaction) => transaction,
      sendTransaction: async () => "sig-123",
      ensure,
    });

    expect(response.state).toBe("ready");
    expect(clientSend).not.toHaveBeenCalled();
  });

  test("creates then reconciles a pending smart account through ensure", async () => {
    const ensure = mock(async (request?: { settingsPda?: string; signature?: string }) =>
      request?.signature ? readyResponse : pendingResponse
    );

    const response = await provisionSmartAccountForWalletSession({
      connection: {} as Connection,
      walletAddress,
      signTransaction: async (transaction) => transaction,
      sendTransaction: async () => "sig-123",
      ensure,
    });

    expect(response.state).toBe("ready");
    expect(prepareCreate).toHaveBeenCalledTimes(1);
    expect(clientSend).toHaveBeenCalledTimes(1);
    expect(ensure.mock.calls).toEqual([
      [],
      [
        {
          settingsPda: pendingResponse.settingsPda,
          signature: "sig-123",
        },
      ],
    ]);
  });

  test("re-runs ensure once after any non-rejection send failure", async () => {
    clientSend
      .mockImplementationOnce(async () => {
        throw new Error("transaction simulation failed");
      })
      .mockImplementationOnce(async () => "sig-456");

    const refreshedSettingsPda = deriveSettingsPdaAddress({
      programId,
      accountIndex: 13n,
    });
    const refreshedPendingResponse = {
      ...pendingResponse,
      settingsPda: refreshedSettingsPda,
      smartAccountAddress: deriveCanonicalSmartAccountAddress({
        programId,
        settingsPda: refreshedSettingsPda,
      }),
    };
    const ensure = mock(
      async (request?: {
        refreshPending?: boolean;
        settingsPda?: string;
        signature?: string;
      }) => {
        if (request?.refreshPending) {
          return refreshedPendingResponse;
        }
        if (request?.signature) {
          return {
            ...readyResponse,
            settingsPda: refreshedPendingResponse.settingsPda,
            smartAccountAddress: refreshedPendingResponse.smartAccountAddress,
            creationSignature: "sig-456",
          };
        }

        return pendingResponse;
      }
    );

    const response = await provisionSmartAccountForWalletSession({
      connection: {} as Connection,
      walletAddress,
      signTransaction: async (transaction) => transaction,
      sendTransaction: async () => "sig-123",
      ensure,
    });

    expect(response.state).toBe("ready");
    expect(ensure.mock.calls).toEqual([
      [],
      [{ refreshPending: true }],
      [
        {
          settingsPda: refreshedPendingResponse.settingsPda,
          signature: "sig-456",
        },
      ],
    ]);
    expect(clientSend).toHaveBeenCalledTimes(2);
  });

  test("keeps reconciling after a successful send until the same settings PDA becomes ready", async () => {
    const ensure = mock(
      async (request?: { settingsPda?: string; signature?: string }) => {
        if (!request?.signature) {
          return pendingResponse;
        }

        if (ensure.mock.calls.length < 4) {
          return pendingResponse;
        }

        return readyResponse;
      }
    );

    const response = await provisionSmartAccountForWalletSession({
      connection: {} as Connection,
      walletAddress,
      signTransaction: async (transaction) => transaction,
      sendTransaction: async () => "sig-123",
      ensure,
    });

    expect(response.state).toBe("ready");
    expect(clientSend).toHaveBeenCalledTimes(1);
    expect(ensure.mock.calls).toEqual([
      [],
      [
        {
          settingsPda: pendingResponse.settingsPda,
          signature: "sig-123",
        },
      ],
      [
        {
          settingsPda: pendingResponse.settingsPda,
          signature: "sig-123",
        },
      ],
      [
        {
          settingsPda: pendingResponse.settingsPda,
          signature: "sig-123",
        },
      ],
    ]);
  });

  test("does not retry when the wallet send is rejected by the user", async () => {
    clientSend.mockImplementationOnce(async () => {
      throw new Error("User rejected the request");
    });
    const ensure = mock(async () => pendingResponse);

    await expect(
      provisionSmartAccountForWalletSession({
        connection: {} as Connection,
        walletAddress,
        signTransaction: async (transaction) => transaction,
        sendTransaction: async () => "sig-123",
        ensure,
      })
    ).rejects.toThrow("User rejected the request");

    expect(ensure.mock.calls).toEqual([[]]);
    expect(clientSend).toHaveBeenCalledTimes(1);
  });

  test("does not refresh and retry when the wallet network does not match", async () => {
    clientSend.mockImplementationOnce(async () => {
      throw new SmartAccountProvisioningNetworkMismatchError({
        solanaEnv: "devnet",
      });
    });
    const ensure = mock(async () => pendingResponse);

    await expect(
      provisionSmartAccountForWalletSession({
        connection: {} as Connection,
        walletAddress,
        signTransaction: async (transaction) => transaction,
        sendTransaction: async () => "sig-123",
        ensure,
      })
    ).rejects.toThrow("Switch the connected wallet to devnet");

    expect(ensure.mock.calls).toEqual([[]]);
    expect(clientSend).toHaveBeenCalledTimes(1);
  });
});
