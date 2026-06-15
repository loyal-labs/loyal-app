import { describe, expect, test } from "bun:test";

import {
  getPerEndpoints,
  getSolanaEndpoints,
  resolveSolanaEnv,
} from "../solana-rpc";

describe("resolveSolanaEnv", () => {
  test("accepts valid env values", () => {
    expect(resolveSolanaEnv("mainnet")).toBe("mainnet");
    expect(resolveSolanaEnv("testnet")).toBe("testnet");
    expect(resolveSolanaEnv("devnet")).toBe("devnet");
    expect(resolveSolanaEnv("localnet")).toBe("localnet");
  });

  test("trims env values", () => {
    expect(resolveSolanaEnv("  mainnet  ")).toBe("mainnet");
  });

  test("falls back to devnet for missing or invalid values", () => {
    expect(resolveSolanaEnv()).toBe("devnet");
    expect(resolveSolanaEnv("staging")).toBe("devnet");
  });

  test("supports a custom default env", () => {
    expect(resolveSolanaEnv(undefined, "mainnet")).toBe("mainnet");
    expect(resolveSolanaEnv("staging", "localnet")).toBe("localnet");
  });
});

describe("getSolanaEndpoints", () => {
  test("returns the mainnet helius endpoints", () => {
    expect(getSolanaEndpoints("mainnet")).toEqual({
      rpcEndpoint: "https://fredra-z7l52f-fast-mainnet.helius-rpc.com",
      websocketEndpoint: "wss://fredra-z7l52f-fast-mainnet.helius-rpc.com",
    });
  });

  test("returns the devnet helius endpoints", () => {
    expect(getSolanaEndpoints("devnet")).toEqual({
      rpcEndpoint: "https://karlotta-a6micy-fast-devnet.helius-rpc.com",
      websocketEndpoint: "wss://karlotta-a6micy-fast-devnet.helius-rpc.com",
    });
  });

  test("returns the public testnet endpoints", () => {
    expect(getSolanaEndpoints("testnet")).toEqual({
      rpcEndpoint: "https://api.testnet.solana.com",
      websocketEndpoint: "wss://api.testnet.solana.com",
    });
  });

  test("returns the local validator endpoints", () => {
    expect(getSolanaEndpoints("localnet")).toEqual({
      rpcEndpoint: "http://127.0.0.1:8899",
      websocketEndpoint: "ws://127.0.0.1:8900",
    });
  });
});

describe("getPerEndpoints", () => {
  test("returns the mainnet PER endpoints", () => {
    expect(getPerEndpoints("mainnet")).toEqual({
      perRpcEndpoint: "https://mainnet-tee.magicblock.app",
      perWsEndpoint: "wss://mainnet-tee.magicblock.app",
    });
  });

  test("returns the devnet PER endpoints for non-mainnet envs", () => {
    expect(getPerEndpoints("devnet")).toEqual({
      perRpcEndpoint: "https://tee.magicblock.app",
      perWsEndpoint: "wss://tee.magicblock.app",
    });
    expect(getPerEndpoints("testnet")).toEqual({
      perRpcEndpoint: "https://tee.magicblock.app",
      perWsEndpoint: "wss://tee.magicblock.app",
    });
    expect(getPerEndpoints("localnet")).toEqual({
      perRpcEndpoint: "https://tee.magicblock.app",
      perWsEndpoint: "wss://tee.magicblock.app",
    });
  });
});
