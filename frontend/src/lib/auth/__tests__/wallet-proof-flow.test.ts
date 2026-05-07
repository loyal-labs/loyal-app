import { describe, expect, mock, test } from "bun:test";

import type { AuthApiClient } from "@/lib/auth/client";
import { runWalletProofFlow } from "@/lib/auth/wallet-proof-flow";

const sessionUser = {
  authMethod: "wallet" as const,
  displayAddress: "wallet-1",
  provider: "solana" as const,
  smartAccountAddress: "smart-account-1",
  settingsPda: "settings-1",
  subjectAddress: "wallet-1",
  walletAddress: "wallet-1",
};

describe("wallet proof flow", () => {
  test("deduplicates concurrent proof requests for one wallet", async () => {
    const challengeWalletAuth = mock(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
      return {
        challengeToken: "challenge-token",
        expiresAt: "2099-03-11T12:00:00.000Z",
        message: "Sign in to Loyal",
      };
    });
    const completeWalletAuth = mock(async () => sessionUser);
    const signMessage = mock(async () => new Uint8Array([1, 2, 3]));
    const authApiClient = {
      challengeWalletAuth,
      completeWalletAuth,
    } as unknown as AuthApiClient;

    const [firstResult, secondResult] = await Promise.all([
      runWalletProofFlow({
        authApiClient,
        messageSigner: signMessage,
        walletAddress: "wallet-1",
      }),
      runWalletProofFlow({
        authApiClient,
        messageSigner: signMessage,
        walletAddress: "wallet-1",
      }),
    ]);

    expect(firstResult).toEqual(sessionUser);
    expect(secondResult).toEqual(sessionUser);
    expect(challengeWalletAuth).toHaveBeenCalledTimes(1);
    expect(signMessage).toHaveBeenCalledTimes(1);
    expect(completeWalletAuth).toHaveBeenCalledTimes(1);
  });
});
