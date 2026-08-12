import { compilePreparedOperation } from "@loyal-labs/loyal-smart-accounts-core";
import type { PreparedLoyalSmartAccountsOperation } from "@loyal-labs/loyal-smart-accounts-core";
import type { Keypair } from "@solana/web3.js";

export function compileDeterministicPolicyTransaction(args: {
  prepared: PreparedLoyalSmartAccountsOperation<string>;
  blockhash: string;
  policySigner: Keypair;
}) {
  const transaction = compilePreparedOperation({
    prepared: args.prepared,
    blockhash: args.blockhash,
  });
  transaction.sign([args.policySigner]);
  return transaction;
}
