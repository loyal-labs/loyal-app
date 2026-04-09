import { afterEach, describe, expect, it } from "bun:test";
import { Keypair } from "@solana/web3.js";

import { LoyalPrivateTransactionsClient } from "../index";
import {
  getKaminoModifyBalanceAccountsForTokenMint,
  USDC_MINT_DEVNET,
  USDC_MINT_MAINNET,
} from "../src/constants";

const originalFetch = globalThis.fetch;

function createReadonlyClient(): LoyalPrivateTransactionsClient {
  const client = Object.create(
    LoyalPrivateTransactionsClient.prototype
  ) as LoyalPrivateTransactionsClient & {
    baseProgram: {
      provider: {
        connection: {
          rpcEndpoint: string;
        };
      };
    };
  };

  client.baseProgram = {
    provider: {
      connection: {
        rpcEndpoint: "https://api.mainnet-beta.solana.com",
      },
    },
  };

  return client;
}

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("Kamino lending APY", () => {
  it("returns null when token mint has no configured Kamino reserve", async () => {
    const client = createReadonlyClient();
    const tokenMint = Keypair.generate().publicKey;

    expect(await client.getKaminoLendingApyBps(tokenMint)).toBeNull();
  });

  it("returns zero for devnet Kamino reserves without calling the API", async () => {
    const client = createReadonlyClient();
    let fetchCalled = false;

    globalThis.fetch = (async () => {
      fetchCalled = true;
      throw new Error("fetch should not be called for devnet Kamino APY");
    }) as typeof fetch;

    expect(await client.getKaminoLendingApyBps(USDC_MINT_DEVNET)).toBe(0);
    expect(fetchCalled).toBe(false);
  });

  it("fetches mainnet reserve APY basis points from the Kamino API", async () => {
    const client = createReadonlyClient();
    const kaminoAccounts =
      getKaminoModifyBalanceAccountsForTokenMint(USDC_MINT_MAINNET);

    if (!kaminoAccounts) {
      throw new Error("Expected mainnet Kamino accounts to be configured");
    }

    let requestUrl = "";
    globalThis.fetch = (async (input) => {
      requestUrl =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.toString()
            : input.url;

      return new Response(
        JSON.stringify([
          {
            reserve: "11111111111111111111111111111111",
            supplyApy: "0.0001",
          },
          {
            reserve: kaminoAccounts.reserve.toBase58(),
            supplyApy: "0.038266801210808055",
          },
        ]),
        {
          status: 200,
          headers: {
            "content-type": "application/json",
          },
        }
      );
    }) as typeof fetch;

    expect(await client.getKaminoLendingApyBps(USDC_MINT_MAINNET)).toBe(383);
    expect(requestUrl).toBe(
      `https://api.kamino.finance/kamino-market/${kaminoAccounts.lendingMarket.toBase58()}/reserves/metrics?env=mainnet-beta`
    );
  });
});
