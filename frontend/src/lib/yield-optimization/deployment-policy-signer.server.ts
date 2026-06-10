import "server-only";

import bs58 from "bs58";
import { Keypair, PublicKey } from "@solana/web3.js";

import { getServerEnv } from "@/lib/core/config/server";

let cachedDeploymentPolicySigner: PublicKey | null = null;

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

export function getDeploymentPolicySignerPublicKey(): PublicKey {
  if (cachedDeploymentPolicySigner) {
    return cachedDeploymentPolicySigner;
  }

  const deploymentPrivateKey = getServerEnv().deploymentPrivateKey;
  if (!deploymentPrivateKey) {
    throw new Error("DEPLOYMENT_PK is not set.");
  }

  cachedDeploymentPolicySigner = Keypair.fromSecretKey(
    decodeDeploymentPrivateKey(deploymentPrivateKey)
  ).publicKey;
  return cachedDeploymentPolicySigner;
}
