"use client";

import { findDepositPda } from "@loyal-labs/private-transactions";
import {
  createSolanaWalletDataClient,
  NATIVE_SOL_MINT,
  type AssetBalance,
  type SecureBalanceMap,
  type SolanaWalletDataClient,
} from "@loyal-labs/solana-wallet";
import { getSolanaEndpoints } from "@loyal-labs/solana-rpc";
import { Connection, PublicKey } from "@solana/web3.js";
import { useWallet } from "@solana/wallet-adapter-react";
import { useMemo } from "react";

import { usePublicEnv } from "@/contexts/public-env-context";

/** Deposit account layout: 8-byte discriminator + 32 user + 32 tokenMint + 8 amount (u64 LE) */
const DEPOSIT_AMOUNT_OFFSET = 8 + 32 + 32; // 72

function readDepositAmount(data: Buffer): bigint {
  if (data.length < DEPOSIT_AMOUNT_OFFSET + 8) return BigInt(0);
  // Read u64 little-endian
  let value = BigInt(0);
  for (let i = 0; i < 8; i++) {
    value += BigInt(data[DEPOSIT_AMOUNT_OFFSET + i]) << BigInt(i * 8);
  }
  return value;
}

export function useSolanaWalletDataClient(): SolanaWalletDataClient {
  const publicEnv = usePublicEnv();
  const wallet = useWallet();
  const walletPublicKey = wallet.publicKey ?? null;

  return useMemo(() => {
    const { rpcEndpoint } = getSolanaEndpoints(publicEnv.solanaEnv);
    const baseConnection = new Connection(rpcEndpoint, "confirmed");

    return createSolanaWalletDataClient({
      env: publicEnv.solanaEnv,
      secureBalanceProvider: async ({ owner, tokenMints, assetBalances }) => {
        const nativeMint = new PublicKey(NATIVE_SOL_MINT);
        const uniqueMints = new Map<string, PublicKey>();
        uniqueMints.set(nativeMint.toBase58(), nativeMint);
        for (const mint of tokenMints) {
          uniqueMints.set(mint.toBase58(), mint);
        }

        // Compute all deposit PDAs and fetch account data in a single batch
        const mintEntries = Array.from(uniqueMints.entries());
        const pdas = mintEntries.map(([, mint]) => findDepositPda(owner, mint)[0]);

        const accountInfos = await baseConnection.getMultipleAccountsInfo(pdas);

        const rawDeposits = new Map<string, bigint>();
        for (let i = 0; i < mintEntries.length; i++) {
          const info = accountInfos[i];
          if (!info?.data) continue;
          const amount = readDepositAmount(info.data as Buffer);
          if (amount > BigInt(0)) {
            rawDeposits.set(mintEntries[i][0], amount);
          }
        }

        return new Map<string, bigint>(
          [...rawDeposits.entries()].filter(([mint]) =>
            assetBalances.some(
              (assetBalance: AssetBalance) => assetBalance.asset.mint === mint
            )
          )
        ) as SecureBalanceMap;
      },
    });
  }, [publicEnv.solanaEnv, walletPublicKey]);
}
