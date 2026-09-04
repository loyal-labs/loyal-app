import {
  AddressLookupTableAccount,
  Connection,
  PublicKey,
  TransactionInstruction,
} from "@solana/web3.js";
import {
  createExecuteTransactionInstruction,
  PROGRAM_ID,
  Transaction,
  TransactionPayloadDetails,
} from "../generated";
import { InvalidPayloadError } from "../../errors.js";
import { getProposalPda, getSmartAccountPda, getTransactionPda } from "../pda";
import { accountsForTransactionExecute } from "../utils";

export async function executeTransaction({
  connection,
  feePayer,
  settingsPda,
  transactionIndex,
  signer,
  programId = PROGRAM_ID,
}: {
  connection: Connection;
  feePayer: PublicKey;
  settingsPda: PublicKey;
  transactionIndex: bigint;
  signer: PublicKey;
  programId?: PublicKey;
}): Promise<{
  instruction: TransactionInstruction;
  lookupTableAccounts: AddressLookupTableAccount[];
}> {
  const [proposalPda] = getProposalPda({
    settingsPda,
    transactionIndex,
    programId,
  });
  const [transactionPda] = getTransactionPda({
    settingsPda,
    transactionIndex,
    programId,
  });
  const transactionAccount = await Transaction.fromAccountAddress(
    connection,
    transactionPda
  );
  const transactionPayload = transactionAccount.payload;
  let transactionDetails: TransactionPayloadDetails;
  if (transactionPayload.__kind === "TransactionPayload") {
    transactionDetails = transactionPayload.fields[0];
  } else {
    throw new InvalidPayloadError(
      `Operation "executeTransaction" expected a Transaction payload for ${settingsPda.toBase58()}:${transactionIndex.toString()}.`
    );
  }

  const [smartAccountPda] = getSmartAccountPda({
    settingsPda,
    accountIndex: transactionDetails.accountIndex,
    programId,
  });

  const { accountMetas, lookupTableAccounts } =
    await accountsForTransactionExecute({
      connection,
      message: transactionDetails.message,
      ephemeralSignerBumps: [...transactionDetails.ephemeralSignerBumps],
      smartAccountPda,
      transactionPda,
      programId,
    });

  return {
    instruction: createExecuteTransactionInstruction(
      {
        consensusAccount: settingsPda,
        signer,
        proposal: proposalPda,
        transaction: transactionPda,
        program: programId,
        anchorRemainingAccounts: accountMetas,
      },
      programId
    ),
    lookupTableAccounts,
  };
}
