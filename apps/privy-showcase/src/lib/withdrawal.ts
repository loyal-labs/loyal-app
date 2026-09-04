import { pda } from "@loyal-labs/loyal-smart-accounts";
import {
  getAssociatedTokenAddressSync,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import { PublicKey } from "@solana/web3.js";
import {
  CANONICAL_USDC_MINT,
  EARN_VAULT_INDEX,
  SQUADS_PROGRAM_ID,
} from "./constants";

export function getPrivyWithdrawalBoundary(args: {
  settings: PublicKey;
  wallet: PublicKey;
  amountRaw: bigint;
}) {
  if (args.amountRaw <= 0n)
    throw new Error("Withdrawal amount must be greater than zero.");
  const vault = pda.getSmartAccountPda({
    settingsPda: args.settings,
    accountIndex: EARN_VAULT_INDEX,
    programId: SQUADS_PROGRAM_ID,
  })[0];
  return {
    amountRaw: args.amountRaw,
    vault,
    sourceAta: getAssociatedTokenAddressSync(
      CANONICAL_USDC_MINT,
      vault,
      true,
      TOKEN_PROGRAM_ID
    ),
    // The API intentionally has no destination argument. The only possible
    // destination is canonical mainnet USDC owned by the root Privy wallet.
    destinationAta: getAssociatedTokenAddressSync(
      CANONICAL_USDC_MINT,
      args.wallet,
      false,
      TOKEN_PROGRAM_ID
    ),
  };
}
