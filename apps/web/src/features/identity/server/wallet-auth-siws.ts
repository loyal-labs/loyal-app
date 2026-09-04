import "server-only";

import type {
  SerializedSolanaSignInOutput,
  SolanaSignInInputJson,
} from "@loyal-labs/auth-core";
import type {
  SolanaSignInInput,
  SolanaSignInOutput,
} from "@solana/wallet-standard-features";
import { verifySignIn } from "@solana/wallet-standard-util";
import { PublicKey } from "@solana/web3.js";
import type { SolanaEnv } from "@loyal-labs/solana-rpc";

import { WalletAuthError } from "./wallet-auth-errors";

export function resolveSiwsChainId(solanaEnv: SolanaEnv): string {
  if (solanaEnv === "mainnet") {
    return "solana:mainnet";
  }

  if (solanaEnv === "devnet") {
    return "solana:devnet";
  }

  if (solanaEnv === "testnet") {
    return "solana:testnet";
  }

  return "solana:localnet";
}

function getOriginParts(origin: string): { domain: string; uri: string } {
  try {
    const url = new URL(origin);
    return {
      domain: url.host,
      uri: url.origin,
    };
  } catch {
    throw new WalletAuthError("Wallet challenge origin is invalid.", {
      code: "invalid_wallet_origin",
      status: 400,
    });
  }
}

export function createWalletAuthSignInInput(args: {
  expiresAt: Date;
  issuedAt: Date;
  nonce: string;
  origin: string;
  solanaEnv: SolanaEnv;
  statement: string;
}): SolanaSignInInputJson {
  const { domain, uri } = getOriginParts(args.origin);

  return {
    domain,
    statement: args.statement,
    uri,
    version: "1",
    chainId: resolveSiwsChainId(args.solanaEnv),
    nonce: args.nonce,
    issuedAt: args.issuedAt.toISOString(),
    expirationTime: args.expiresAt.toISOString(),
  };
}

function toUint8Array(bytes: number[]): Uint8Array {
  return new Uint8Array(bytes);
}

function deserializeSignInOutput(
  output: SerializedSolanaSignInOutput
): SolanaSignInOutput {
  return {
    account: {
      ...output.account,
      publicKey: toUint8Array(output.account.publicKey),
    } as SolanaSignInOutput["account"],
    signedMessage: toUint8Array(output.signedMessage),
    signature: toUint8Array(output.signature),
    signatureType: output.signatureType,
  };
}

export function verifyWalletSignInOutput(args: {
  input: SolanaSignInInputJson;
  output: SerializedSolanaSignInOutput;
}): string {
  if (args.output.signatureType && args.output.signatureType !== "ed25519") {
    throw new WalletAuthError("Wallet sign-in signature type is invalid.", {
      code: "invalid_wallet_signin_signature_type",
      status: 401,
    });
  }

  const signInOutput = deserializeSignInOutput(args.output);
  let derivedAddress: string;

  try {
    derivedAddress = new PublicKey(signInOutput.account.publicKey).toBase58();
  } catch {
    throw new WalletAuthError("Wallet sign-in public key is invalid.", {
      code: "invalid_wallet_signin_public_key",
      status: 400,
    });
  }

  if (derivedAddress !== signInOutput.account.address) {
    throw new WalletAuthError(
      "Wallet sign-in account address does not match the public key.",
      {
        code: "wallet_signin_address_mismatch",
        status: 401,
      }
    );
  }

  if (!verifySignIn(args.input as SolanaSignInInput, signInOutput)) {
    throw new WalletAuthError("Wallet sign-in could not be verified.", {
      code: "invalid_wallet_signin",
      status: 401,
      details: {
        walletAddress: derivedAddress,
      },
    });
  }

  return derivedAddress;
}
