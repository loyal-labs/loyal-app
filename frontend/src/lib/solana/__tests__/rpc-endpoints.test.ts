import { afterEach, describe, expect, test } from "bun:test";

import { getFrontendSolanaEndpoints } from "../rpc-endpoints";

const previousRpcUrl = process.env.SOLANA_RPC_URL;
const previousWsUrl = process.env.SOLANA_WEBSOCKET_URL;
const previousMainnetRpcUrl = process.env.SOLANA_MAINNET_RPC_URL;
const previousMainnetWsUrl = process.env.SOLANA_MAINNET_WEBSOCKET_URL;
const previousDevnetRpcUrl = process.env.SOLANA_DEVNET_RPC_URL;
const previousDevnetWsUrl = process.env.SOLANA_DEVNET_WEBSOCKET_URL;

afterEach(() => {
  if (previousRpcUrl === undefined) {
    delete process.env.SOLANA_RPC_URL;
  } else {
    process.env.SOLANA_RPC_URL = previousRpcUrl;
  }

  if (previousWsUrl === undefined) {
    delete process.env.SOLANA_WEBSOCKET_URL;
  } else {
    process.env.SOLANA_WEBSOCKET_URL = previousWsUrl;
  }

  if (previousMainnetRpcUrl === undefined) {
    delete process.env.SOLANA_MAINNET_RPC_URL;
  } else {
    process.env.SOLANA_MAINNET_RPC_URL = previousMainnetRpcUrl;
  }

  if (previousMainnetWsUrl === undefined) {
    delete process.env.SOLANA_MAINNET_WEBSOCKET_URL;
  } else {
    process.env.SOLANA_MAINNET_WEBSOCKET_URL = previousMainnetWsUrl;
  }

  if (previousDevnetRpcUrl === undefined) {
    delete process.env.SOLANA_DEVNET_RPC_URL;
  } else {
    process.env.SOLANA_DEVNET_RPC_URL = previousDevnetRpcUrl;
  }

  if (previousDevnetWsUrl === undefined) {
    delete process.env.SOLANA_DEVNET_WEBSOCKET_URL;
  } else {
    process.env.SOLANA_DEVNET_WEBSOCKET_URL = previousDevnetWsUrl;
  }
});

describe("getFrontendSolanaEndpoints", () => {
  test("keeps devnet on devnet endpoint when only generic mainnet override exists", () => {
    process.env.SOLANA_RPC_URL = " https://rpc.example ";

    expect(getFrontendSolanaEndpoints("devnet")).toEqual({
      rpcEndpoint: "https://aurora-o23cd4-fast-devnet.helius-rpc.com",
      websocketEndpoint: "wss://aurora-o23cd4-fast-devnet.helius-rpc.com",
    });
  });

  test("uses cluster-specific devnet RPC override when configured", () => {
    process.env.SOLANA_DEVNET_RPC_URL = " https://devnet-rpc.example ";

    expect(getFrontendSolanaEndpoints("devnet")).toEqual({
      rpcEndpoint: "https://devnet-rpc.example",
      websocketEndpoint: "wss://aurora-o23cd4-fast-devnet.helius-rpc.com",
    });
  });

  test("uses explicit websocket override when configured", () => {
    process.env.SOLANA_MAINNET_RPC_URL = "https://rpc.example";
    process.env.SOLANA_MAINNET_WEBSOCKET_URL = " wss://ws.example ";

    expect(getFrontendSolanaEndpoints("mainnet")).toEqual({
      rpcEndpoint: "https://rpc.example",
      websocketEndpoint: "wss://ws.example",
    });
  });

  test("keeps localnet on local validator endpoints", () => {
    process.env.SOLANA_RPC_URL = "https://rpc.example";

    expect(getFrontendSolanaEndpoints("localnet")).toEqual({
      rpcEndpoint: "http://127.0.0.1:8899",
      websocketEndpoint: "ws://127.0.0.1:8900",
    });
  });
});
