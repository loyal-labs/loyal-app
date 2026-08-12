import {
  PublicKey,
  Transaction,
  type TransactionInstruction,
} from "@solana/web3.js";

type ValidateGaslessStoreTransactionArgs = {
  transaction: Transaction;
  expectedInstruction: TransactionInstruction;
  payer: PublicKey;
  recipient: PublicKey;
};

export const validateGaslessStoreTransaction = ({
  transaction,
  expectedInstruction,
  payer,
  recipient,
}: ValidateGaslessStoreTransactionArgs): void => {
  if (!transaction.feePayer?.equals(payer)) {
    throw new Error("Gasless transaction has an invalid fee payer");
  }

  if (transaction.instructions.length !== 1) {
    throw new Error("Gasless transaction must contain exactly one instruction");
  }

  const [instruction] = transaction.instructions;
  if (!instruction.programId.equals(expectedInstruction.programId)) {
    throw new Error("Gasless transaction targets an invalid program");
  }

  if (
    !Buffer.from(instruction.data).equals(
      Buffer.from(expectedInstruction.data)
    )
  ) {
    throw new Error("Gasless transaction contains invalid instruction data");
  }

  if (instruction.keys.length !== expectedInstruction.keys.length) {
    throw new Error("Gasless transaction contains invalid instruction accounts");
  }

  for (let index = 0; index < expectedInstruction.keys.length; index += 1) {
    const actual = instruction.keys[index];
    const expected = expectedInstruction.keys[index];
    if (
      !actual.pubkey.equals(expected.pubkey) ||
      actual.isSigner !== expected.isSigner ||
      actual.isWritable !== expected.isWritable
    ) {
      throw new Error("Gasless transaction contains invalid instruction accounts");
    }
  }

  const recipientSignature = transaction.signatures.find(({ publicKey }) =>
    publicKey.equals(recipient)
  )?.signature;
  if (!recipientSignature || !transaction.verifySignatures(false)) {
    throw new Error("Gasless transaction is missing a valid recipient signature");
  }

  const requiredSignerAddresses = transaction.signatures.map(({ publicKey }) =>
    publicKey.toBase58()
  );
  if (
    requiredSignerAddresses.length !== 2 ||
    !requiredSignerAddresses.includes(payer.toBase58()) ||
    !requiredSignerAddresses.includes(recipient.toBase58())
  ) {
    throw new Error("Gasless transaction contains invalid required signers");
  }
};
