import assert from "node:assert/strict";
import { mock } from "bun:test";
import { Connection, PublicKey } from "@solana/web3.js";

mock.module("server-only", () => ({}));
mock.module("@/lib/core/config/server", () => ({
  getServerEnv: () => ({ solanaEnv: "mainnet" }),
}));
mock.module("@/lib/solana/rpc-endpoints.server", () => ({
  getServerSolanaEndpoints: () => ({ rpcEndpoint: "https://example.com" }),
}));
mock.module("@/lib/solana/rpc-rate-limit", () => ({
  getFrontendSolanaRpcFetch: () => globalThis.fetch,
}));

const { VOLTR_ASSET_MINT } = await import(
  "../src/features/earn-max/voltr/program"
);
const { readEarnMaxWalletUsdcBalance } = await import(
  "../src/features/earn-max/voltr/summary.server"
);
const wallet = "11111111111111111111111111111111";
let accounts: {
  account: {
    data: {
      parsed: { info: { state: string; tokenAmount: { amount: string } } };
    };
  };
}[] = [];
const original = Connection.prototype.getParsedTokenAccountsByOwner;
Connection.prototype.getParsedTokenAccountsByOwner = (async (
  owner: PublicKey,
  filter: { mint: PublicKey }
) => {
  assert.equal(owner.toBase58(), wallet);
  assert.equal(filter.mint.toBase58(), VOLTR_ASSET_MINT.toBase58());
  return { value: accounts };
}) as typeof original;
const token = (amount: string, state = "initialized") => ({
  account: { data: { parsed: { info: { state, tokenAmount: { amount } } } } },
});
try {
  assert.equal(await readEarnMaxWalletUsdcBalance(wallet), BigInt(0));
  accounts = [token("600000"), token("400000"), token("9000000", "frozen")];
  assert.equal(
    await readEarnMaxWalletUsdcBalance(wallet),
    BigInt(1000000),
    "sum spendable USDC without frozen funds"
  );
  accounts = [token("9007199254740993")];
  assert.equal(
    await readEarnMaxWalletUsdcBalance(wallet),
    BigInt("9007199254740993"),
    "retain raw integer precision"
  );
  accounts = [token("not-an-amount")];
  await assert.rejects(() => readEarnMaxWalletUsdcBalance(wallet));
  Connection.prototype.getParsedTokenAccountsByOwner = async () => {
    throw new Error("RPC unavailable");
  };
  await assert.rejects(
    () => readEarnMaxWalletUsdcBalance(wallet),
    /RPC unavailable/
  );
} finally {
  Connection.prototype.getParsedTokenAccountsByOwner = original;
}
console.log(
  "Earn MAX setup funding reads canonical wallet USDC, excludes frozen funds, preserves precision and fails closed."
);
