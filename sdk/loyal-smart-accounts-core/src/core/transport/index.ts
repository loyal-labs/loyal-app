import { TransactionMessage, VersionedTransaction } from "@solana/web3.js";
import type {
  AddressLookupTableAccount,
  Commitment,
  Connection,
  PublicKey,
  SendOptions,
  Signer,
  TransactionInstruction,
} from "@solana/web3.js";
import { PROGRAM_ID } from "../generated/index.js";
import { translateAndThrowAnchorError } from "../errors/index.js";

export type PreparedLoyalSmartAccountsOperation<
  Name extends string = string,
> = Readonly<{
  operation: Name;
  payer: PublicKey;
  programId: PublicKey;
  requiresConfirmation: boolean;
  instructions: readonly TransactionInstruction[];
  lookupTableAccounts: readonly AddressLookupTableAccount[];
}>;

export type LoyalSmartAccountsConfirmationContext = {
  prepared: PreparedLoyalSmartAccountsOperation<string>;
  blockhash: string;
  lastValidBlockHeight: number;
  commitment?: Commitment;
};

export type LoyalSmartAccountsSendPreparedContext = {
  blockhash: string;
  lastValidBlockHeight: number;
  commitment?: Commitment;
  sendOptions?: SendOptions;
  compileUnsignedTransaction: () => VersionedTransaction;
};

export type LoyalSmartAccountsSendPreparedFn = (
  prepared: PreparedLoyalSmartAccountsOperation<string>,
  signers: readonly Signer[],
  context: LoyalSmartAccountsSendPreparedContext
) => Promise<string>;

export type LoyalSmartAccountsConfirmFn = (
  signature: string,
  context: LoyalSmartAccountsConfirmationContext
) => Promise<void>;

export type LoyalSmartAccountsClientConfig = {
  connection: Connection;
  programId?: PublicKey;
  defaultCommitment?: Commitment;
  sendPrepared?: LoyalSmartAccountsSendPreparedFn;
  confirm?: LoyalSmartAccountsConfirmFn;
};

export type LoyalSmartAccountsTransport = {
  connection: Connection;
  programId: PublicKey;
  defaultCommitment?: Commitment;
  sendPrepared?: LoyalSmartAccountsSendPreparedFn;
  confirm?: LoyalSmartAccountsConfirmFn;
};

export type LoyalSmartAccountsSendOptions = SendOptions;
export type LoyalSmartAccountsConfirmBehavior = true | false | "if-required";

export function createTransport(
  config: LoyalSmartAccountsClientConfig
): LoyalSmartAccountsTransport {
  return {
    connection: config.connection,
    programId: config.programId ?? PROGRAM_ID,
    defaultCommitment: config.defaultCommitment,
    sendPrepared: config.sendPrepared,
    confirm: config.confirm,
  };
}

export function freezePreparedOperation<Name extends string>(
  operation: PreparedLoyalSmartAccountsOperation<Name>
): PreparedLoyalSmartAccountsOperation<Name> {
  return Object.freeze({
    ...operation,
    instructions: Object.freeze([...operation.instructions]),
    lookupTableAccounts: Object.freeze([...operation.lookupTableAccounts]),
  });
}

function dedupeSigners(signers: readonly Signer[]): Signer[] {
  const unique = new Map<string, Signer>();
  for (const signer of signers) {
    unique.set(signer.publicKey.toBase58(), signer);
  }
  return [...unique.values()];
}

async function confirmPreparedOperation(args: {
  transport: LoyalSmartAccountsTransport;
  prepared: PreparedLoyalSmartAccountsOperation<string>;
  signature: string;
  blockhash: string;
  lastValidBlockHeight: number;
}): Promise<void> {
  const context: LoyalSmartAccountsConfirmationContext = {
    prepared: args.prepared,
    blockhash: args.blockhash,
    lastValidBlockHeight: args.lastValidBlockHeight,
    commitment: args.transport.defaultCommitment,
  };

  if (args.transport.confirm) {
    await args.transport.confirm(args.signature, context);
    return;
  }

  const confirmation = await args.transport.connection.confirmTransaction(
    {
      signature: args.signature,
      blockhash: args.blockhash,
      lastValidBlockHeight: args.lastValidBlockHeight,
    },
    args.transport.defaultCommitment
  );

  if (confirmation.value.err) {
    throw new Error(
      `Transaction ${args.signature} failed to confirm: ${JSON.stringify(
        confirmation.value.err
      )}`
    );
  }
}

export function compilePreparedOperation(args: {
  prepared: PreparedLoyalSmartAccountsOperation<string>;
  blockhash: string;
}): VersionedTransaction {
  const message = new TransactionMessage({
    payerKey: args.prepared.payer,
    recentBlockhash: args.blockhash,
    instructions: [...args.prepared.instructions],
  }).compileToV0Message([...args.prepared.lookupTableAccounts]);

  return new VersionedTransaction(message);
}

export async function sendPreparedOperation(args: {
  transport: LoyalSmartAccountsTransport;
  prepared: PreparedLoyalSmartAccountsOperation<string>;
  signers: Signer[];
  sendOptions?: LoyalSmartAccountsSendOptions;
  confirm?: LoyalSmartAccountsConfirmBehavior;
}): Promise<string> {
  const { transport, prepared, sendOptions } = args;
  const signers = dedupeSigners(args.signers);
  const latestBlockhash = await transport.connection.getLatestBlockhash(
    transport.defaultCommitment
  );

  try {
    const compileUnsignedTransaction = () =>
      compilePreparedOperation({
        prepared,
        blockhash: latestBlockhash.blockhash,
      });

    const signature = transport.sendPrepared
      ? await transport.sendPrepared(prepared, signers, {
          blockhash: latestBlockhash.blockhash,
          lastValidBlockHeight: latestBlockhash.lastValidBlockHeight,
          commitment: transport.defaultCommitment,
          sendOptions,
          compileUnsignedTransaction,
        })
      : await (async () => {
          const transaction = compileUnsignedTransaction();
          transaction.sign(signers);
          return transport.connection.sendTransaction(transaction, sendOptions);
        })();

    const shouldConfirm =
      args.confirm === true ||
      (args.confirm !== false && prepared.requiresConfirmation);

    if (shouldConfirm) {
      await confirmPreparedOperation({
        transport,
        prepared,
        signature,
        blockhash: latestBlockhash.blockhash,
        lastValidBlockHeight: latestBlockhash.lastValidBlockHeight,
      });
    }

    return signature;
  } catch (error) {
    translateAndThrowAnchorError(error);
    throw error;
  }
}
