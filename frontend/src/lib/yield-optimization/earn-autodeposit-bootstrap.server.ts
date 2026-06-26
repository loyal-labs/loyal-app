import "server-only";

import { createHash } from "node:crypto";

import { TOKEN_PROGRAM_ID, unpackAccount } from "@solana/spl-token";
import { PublicKey, type Commitment, type Connection } from "@solana/web3.js";

import type {
  BalanceSweepTargetRecord,
  EarnAutodepositBootstrapWalletBalanceSnapshot,
} from "./earn-autodeposit-repository.server";

export async function readEarnAutodepositBootstrapWalletBalanceSnapshot(args: {
  connection: Connection;
  source: string;
  sourceCommitment: Commitment;
  target: BalanceSweepTargetRecord;
}): Promise<
  | {
      snapshot: EarnAutodepositBootstrapWalletBalanceSnapshot;
      status: "ok";
    }
  | {
      reason: string;
      status: "skipped";
    }
> {
  const walletTokenAta = new PublicKey(args.target.walletTokenAta);
  const account = await args.connection.getAccountInfoAndContext(
    walletTokenAta,
    args.sourceCommitment
  );

  if (!account.value) {
    return { reason: "wallet_token_ata_missing", status: "skipped" };
  }

  if (!account.value.owner.equals(TOKEN_PROGRAM_ID)) {
    return { reason: "wallet_token_ata_invalid_owner", status: "skipped" };
  }

  let tokenAccount: ReturnType<typeof unpackAccount>;
  try {
    tokenAccount = unpackAccount(
      walletTokenAta,
      account.value,
      TOKEN_PROGRAM_ID
    );
  } catch {
    return { reason: "wallet_token_ata_invalid_data", status: "skipped" };
  }

  const tokenMint = tokenAccount.mint.toBase58();
  if (tokenMint !== args.target.tokenMint) {
    return { reason: "wallet_token_ata_mint_mismatch", status: "skipped" };
  }

  const tokenOwner = tokenAccount.owner.toBase58();
  if (tokenOwner !== args.target.wallet) {
    return { reason: "wallet_token_ata_wallet_mismatch", status: "skipped" };
  }

  const accountDataHash = createHash("sha256")
    .update(account.value.data)
    .digest("hex");

  return {
    snapshot: {
      accountDataHash,
      amountRaw: tokenAccount.amount,
      mint: tokenMint,
      observedAt: new Date(),
      observedSlot: BigInt(account.context.slot),
      owner: tokenOwner,
      rawEvidence: {
        accountLamports: account.value.lamports.toString(),
        accountOwner: account.value.owner.toBase58(),
        artifactReconcileBootstrap: true,
        setupSignature:
          args.target.recurringDelegationSignature ??
          args.target.lastSeenSignature,
      },
      source: args.source,
      sourceCommitment: args.sourceCommitment,
    },
    status: "ok",
  };
}
