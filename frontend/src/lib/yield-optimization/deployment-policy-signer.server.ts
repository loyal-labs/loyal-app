import "server-only";

import bs58 from "bs58";
import { Keypair, PublicKey } from "@solana/web3.js";

import { getServerEnv } from "@/lib/core/config/server";

let cachedDeploymentPolicySigner: PublicKey | null = null;
let cachedDeploymentPolicySignerSource: string | null = null;

function decodeDeploymentPrivateKey(value: string): Uint8Array {
  const trimmed = value.trim();

  if (trimmed.startsWith("[")) {
    return Uint8Array.from(JSON.parse(trimmed) as number[]);
  }

  if (/^[0-9a-fA-F]+$/.test(trimmed) && trimmed.length % 2 === 0) {
    return Uint8Array.from(
      trimmed.match(/../g)!.map((byte) => Number.parseInt(byte, 16))
    );
  }

  return bs58.decode(trimmed);
}

function publicKeyFromPrivateKey(value: string): PublicKey {
  const bytes = decodeDeploymentPrivateKey(value);
  return (
    bytes.length === 32 ? Keypair.fromSeed(bytes) : Keypair.fromSecretKey(bytes)
  ).publicKey;
}

export function getDeploymentPolicySignerPublicKey(): PublicKey {
  const serverEnv = getServerEnv();
  const signerSource =
    serverEnv.earnYieldRouterPublicKey ?? serverEnv.deploymentPrivateKey;

  if (!signerSource) {
    throw new Error(
      "EARN_YIELD_ROUTER_PUBLIC_KEY or DEPLOYMENT_PK is not set."
    );
  }

  if (
    cachedDeploymentPolicySigner &&
    cachedDeploymentPolicySignerSource === signerSource
  ) {
    return cachedDeploymentPolicySigner;
  }

  if (serverEnv.earnYieldRouterPublicKey) {
    cachedDeploymentPolicySigner = new PublicKey(
      serverEnv.earnYieldRouterPublicKey
    );
    cachedDeploymentPolicySignerSource = signerSource;
    return cachedDeploymentPolicySigner;
  }

  cachedDeploymentPolicySigner = publicKeyFromPrivateKey(signerSource);
  cachedDeploymentPolicySignerSource = signerSource;
  return cachedDeploymentPolicySigner;
}
