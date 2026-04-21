import bs58 from "bs58";
import {
  createLoyalSmartAccountsClient,
  pda,
  type LoyalSmartAccountsClient,
  type PreparedLoyalSmartAccountsOperation,
} from "@loyal-labs/loyal-smart-accounts";
import {
  Proposal,
  Transaction,
  freezePreparedOperation,
  proposalDiscriminator,
  toBigInt,
  transactionDiscriminator,
} from "@loyal-labs/loyal-smart-accounts-core";
import type {
  PortfolioPosition,
  SolanaWalletDataClient,
} from "@loyal-labs/solana-wallet";
import { decodeTransferCheckedInstruction } from "@solana/spl-token";
import {
  PublicKey,
  SystemInstruction,
  SystemProgram,
  type AccountInfo,
  type AddressLookupTableAccount,
  type Connection,
  type GetProgramAccountsFilter,
} from "@solana/web3.js";
import {
  createVaultSolTransferMessage,
  createVaultSplTransferMessage,
  isSupportedTokenProgram,
  resolveVaultAccountIndex,
} from "./messages";
import type {
  SmartAccountOverview,
  SmartAccountProposalSnapshot,
  SmartAccountProposalStatus,
  SmartAccountProposalSummary,
  SmartAccountTokenTransferProposalInput,
  SmartAccountTransferProposalInput,
  SmartAccountVaultSnapshot,
  SmartAccountVaultsClientConfig,
} from "./types";

type VaultMessage = {
  numSigners: number;
  numWritableSigners: number;
  numWritableNonSigners: number;
  accountKeys: PublicKey[];
  instructions: Array<{
    programIdIndex: number;
    accountIndexes: Uint8Array;
    data: Uint8Array;
  }>;
};

type TransactionPayloadDetailsLike = {
  accountIndex: number;
  message: VaultMessage;
};

type TransactionPayloadLike = Transaction["payload"] & {
  __kind: "TransactionPayload";
  fields: [TransactionPayloadDetailsLike];
};

function dedupeLookupTableAccounts(
  lookupTableAccounts: readonly AddressLookupTableAccount[]
) {
  const unique = new Map<string, AddressLookupTableAccount>();

  for (const account of lookupTableAccounts) {
    unique.set(account.key.toBase58(), account);
  }

  return [...unique.values()];
}

function mergePreparedOperations(args: {
  operation: string;
  payer: PublicKey;
  programId: PublicKey;
  operations: ReadonlyArray<PreparedLoyalSmartAccountsOperation<string>>;
}): PreparedLoyalSmartAccountsOperation<string> {
  return freezePreparedOperation({
    operation: args.operation,
    payer: args.payer,
    programId: args.programId,
    requiresConfirmation: args.operations.some(
      (operation) => operation.requiresConfirmation
    ),
    instructions: args.operations.flatMap((operation) => operation.instructions),
    lookupTableAccounts: dedupeLookupTableAccounts(
      args.operations.flatMap((operation) => operation.lookupTableAccounts)
    ),
  });
}

function toProposalStatus(statusKind: string): SmartAccountProposalStatus {
  switch (statusKind.toLowerCase()) {
    case "draft":
      return "draft";
    case "active":
      return "active";
    case "approved":
      return "approved";
    case "rejected":
      return "rejected";
    case "executing":
      return "executing";
    case "executed":
      return "executed";
    case "cancelled":
      return "cancelled";
    default:
      return "active";
  }
}

function getWritableFlags(
  message: VaultMessage,
  accountIndex: number
): boolean {
  if (accountIndex < message.numWritableSigners) {
    return true;
  }

  if (accountIndex < message.numSigners) {
    return false;
  }

  return accountIndex - message.numSigners < message.numWritableNonSigners;
}

function compileVaultInstructions(message: VaultMessage) {
  return message.instructions.map((instruction) => {
    const programId = message.accountKeys[instruction.programIdIndex];
    const keys = Array.from(instruction.accountIndexes).map((accountIndex: number) => ({
      pubkey: message.accountKeys[accountIndex],
      isSigner: accountIndex < message.numSigners,
      isWritable: getWritableFlags(message, accountIndex),
    }));

    return {
      programId,
      keys,
      data: Buffer.from(instruction.data),
    };
  });
}

function formatTokenAmount(amountRaw: bigint, decimals: number): string {
  if (decimals === 0) {
    return amountRaw.toString();
  }

  const base = BigInt(10) ** BigInt(decimals);
  const whole = amountRaw / base;
  const fraction = amountRaw % base;

  if (fraction === BigInt(0)) {
    return whole.toString();
  }

  const paddedFraction = fraction.toString().padStart(decimals, "0");
  return `${whole.toString()}.${paddedFraction.replace(/0+$/, "")}`;
}

function findAssetMetadata(
  assetIndex: Map<string, PortfolioPosition>,
  mint: string | null
) {
  if (!mint) {
    return null;
  }

  return assetIndex.get(mint) ?? null;
}

function summarizeUnknownInstruction(args: {
  programId: PublicKey | null;
  instructionCount: number;
}): SmartAccountProposalSummary {
  return {
    kind: "unknown",
    title: "Transaction",
    subtitle: args.programId
      ? `Program ${args.programId.toBase58()}`
      : "Unknown instruction payload",
    symbol: null,
    amountUi: null,
    amountRaw: null,
    mint: null,
    decimals: null,
    destination: null,
    programId: args.programId?.toBase58() ?? null,
    instructionCount: args.instructionCount,
  };
}

function summarizeTransactionPayload(args: {
  payload: Transaction["payload"];
  assetIndex: Map<string, PortfolioPosition>;
}): {
  summary: SmartAccountProposalSummary;
  accountIndex: number | null;
} {
  if (args.payload.__kind !== "TransactionPayload") {
    return {
      accountIndex: null,
      summary: summarizeUnknownInstruction({
        programId: null,
        instructionCount: 0,
      }),
    };
  }

  const details = (args.payload as TransactionPayloadLike).fields[0];
  const instructions = compileVaultInstructions(details.message);
  const transferInstruction =
    instructions.find(
      (instruction) => instruction.programId.equals(SystemProgram.programId)
    ) ??
    instructions.find((instruction) =>
      isSupportedTokenProgram(instruction.programId)
    ) ??
    instructions[0] ??
    null;

  if (!transferInstruction) {
    return {
      accountIndex: details.accountIndex,
      summary: summarizeUnknownInstruction({
        programId: null,
        instructionCount: 0,
      }),
    };
  }

  if (transferInstruction.programId.equals(SystemProgram.programId)) {
    const decoded = SystemInstruction.decodeTransfer({
      programId: transferInstruction.programId,
      keys: transferInstruction.keys,
      data: transferInstruction.data,
    });

    return {
      accountIndex: details.accountIndex,
      summary: {
        kind: "sol_transfer",
        title: "Send",
        subtitle: `to ${decoded.toPubkey.toBase58()}`,
        symbol: "SOL",
        amountUi: formatTokenAmount(BigInt(decoded.lamports), 9),
        amountRaw: BigInt(decoded.lamports).toString(),
        mint: null,
        decimals: 9,
        destination: decoded.toPubkey.toBase58(),
        programId: transferInstruction.programId.toBase58(),
        instructionCount: instructions.length,
      },
    };
  }

  if (isSupportedTokenProgram(transferInstruction.programId)) {
    try {
      const decoded = decodeTransferCheckedInstruction(
        {
          programId: transferInstruction.programId,
          keys: transferInstruction.keys,
          data: transferInstruction.data,
        },
        transferInstruction.programId
      );
      const mint = decoded.keys.mint.pubkey.toBase58();
      const asset = findAssetMetadata(args.assetIndex, mint);

      return {
        accountIndex: details.accountIndex,
        summary: {
          kind: "spl_transfer",
          title: "Send",
          subtitle: `to ${decoded.keys.destination.pubkey.toBase58()}`,
          symbol: asset?.asset.symbol ?? null,
          amountUi: formatTokenAmount(
            BigInt(decoded.data.amount.toString()),
            decoded.data.decimals
          ),
          amountRaw: decoded.data.amount.toString(),
          mint,
          decimals: decoded.data.decimals,
          destination: decoded.keys.destination.pubkey.toBase58(),
          programId: transferInstruction.programId.toBase58(),
          instructionCount: instructions.length,
        },
      };
    } catch {
      return {
        accountIndex: details.accountIndex,
        summary: summarizeUnknownInstruction({
          programId: transferInstruction.programId,
          instructionCount: instructions.length,
        }),
      };
    }
  }

  return {
    accountIndex: details.accountIndex,
    summary: summarizeUnknownInstruction({
      programId: transferInstruction.programId,
      instructionCount: instructions.length,
    }),
  };
}

function createProposalFilters(settingsPda: PublicKey): GetProgramAccountsFilter[] {
  return [
    {
      memcmp: {
        offset: 0,
        bytes: bs58.encode(Buffer.from(proposalDiscriminator)),
      },
    },
    {
      memcmp: {
        offset: 8,
        bytes: settingsPda.toBase58(),
      },
    },
  ];
}

function createTransactionFilters(
  settingsPda: PublicKey
): GetProgramAccountsFilter[] {
  return [
    {
      memcmp: {
        offset: 0,
        bytes: bs58.encode(Buffer.from(transactionDiscriminator)),
      },
    },
    {
      memcmp: {
        offset: 8,
        bytes: settingsPda.toBase58(),
      },
    },
  ];
}

function deserializeProposalAccount(args: {
  pubkey: PublicKey;
  account: AccountInfo<Buffer>;
}) {
  const [proposal] = Proposal.fromAccountInfo(args.account);
  return {
    address: args.pubkey,
    proposal,
  };
}

function deserializeTransactionAccount(args: {
  pubkey: PublicKey;
  account: AccountInfo<Buffer>;
}) {
  const [transaction] = Transaction.fromAccountInfo(args.account);
  return {
    address: args.pubkey,
    transaction,
  };
}

function toAssetIndex(vaults: readonly SmartAccountVaultSnapshot[]) {
  const index = new Map<string, PortfolioPosition>();

  for (const vault of vaults) {
    for (const position of vault.portfolio.positions) {
      index.set(position.asset.mint, position);
    }
  }

  return index;
}

function requireWalletDataClient(
  walletDataClient: SolanaWalletDataClient | undefined
): SolanaWalletDataClient {
  if (!walletDataClient) {
    throw new Error(
      "A SolanaWalletDataClient is required for vault portfolio and activity queries."
    );
  }

  return walletDataClient;
}

export type SmartAccountVaultsClient = ReturnType<
  typeof createSmartAccountVaultsClient
>;

export function createSmartAccountVaultsClient(
  config: SmartAccountVaultsClientConfig
) {
  const smartAccountsClient: LoyalSmartAccountsClient = createLoyalSmartAccountsClient(
    {
      connection: config.connection,
      programId: config.programId,
      defaultCommitment: "confirmed",
    }
  );
  const walletDataClient = config.walletDataClient;

  async function fetchVault(args: {
    settingsPda: PublicKey;
    accountIndex?: number;
    activityLimit?: number;
  }): Promise<SmartAccountVaultSnapshot> {
    const accountIndex = resolveVaultAccountIndex(args.accountIndex);
    const vaultAddress = pda.getSmartAccountPda({
      programId: smartAccountsClient.programId,
      settingsPda: args.settingsPda,
      accountIndex,
    })[0];
    const dataClient = requireWalletDataClient(walletDataClient);
    const [lamports, portfolio, activity] = await Promise.all([
      config.connection.getBalance(vaultAddress, "confirmed"),
      dataClient.getPortfolio(vaultAddress),
      dataClient.getActivity(vaultAddress, {
        limit: args.activityLimit ?? 25,
      }),
    ]);

    return {
      accountIndex,
      address: vaultAddress.toBase58(),
      lamports,
      portfolio,
      activity,
    };
  }

  async function listVaults(args: {
    settingsPda: PublicKey;
    accountUtilization?: number;
    activityLimit?: number;
  }): Promise<SmartAccountVaultSnapshot[]> {
    const settings =
      args.accountUtilization === undefined
        ? await smartAccountsClient.smartAccounts.queries.fetchSettings(
            args.settingsPda
          )
        : null;
    const highestAccountIndex =
      args.accountUtilization ?? settings?.accountUtilization ?? 0;
    const accountIndexes = Array.from(
      { length: Math.max(highestAccountIndex + 1, 1) },
      (_, index) => index
    );

    return Promise.all(
      accountIndexes.map((accountIndex) =>
        fetchVault({
          settingsPda: args.settingsPda,
          accountIndex,
          activityLimit: args.activityLimit,
        })
      )
    );
  }

  async function listProposals(args: {
    settingsPda: PublicKey;
    assetIndex?: Map<string, PortfolioPosition>;
  }): Promise<SmartAccountProposalSnapshot[]> {
    const [proposalAccounts, transactionAccounts] = await Promise.all([
      config.connection.getProgramAccounts(smartAccountsClient.programId, {
        commitment: "confirmed",
        filters: createProposalFilters(args.settingsPda),
      }),
      config.connection.getProgramAccounts(smartAccountsClient.programId, {
        commitment: "confirmed",
        filters: createTransactionFilters(args.settingsPda),
      }),
    ]);
    const transactionsByIndex = new Map(
      transactionAccounts.map((account) => {
        const deserialized = deserializeTransactionAccount(account);
        return [toBigInt(deserialized.transaction.index).toString(), deserialized];
      })
    );
    const assetIndex = args.assetIndex ?? new Map<string, PortfolioPosition>();

    return proposalAccounts
      .map((account) => deserializeProposalAccount(account))
      .map((entry) => {
        const transactionIndex = toBigInt(entry.proposal.transactionIndex).toString();
        const transaction = transactionsByIndex.get(transactionIndex) ?? null;
        const payloadSummary = transaction
          ? summarizeTransactionPayload({
              payload: transaction.transaction.payload,
              assetIndex,
            })
          : {
              accountIndex: null,
              summary: summarizeUnknownInstruction({
                programId: null,
                instructionCount: 0,
              }),
            };

        return {
          proposalAddress: entry.address.toBase58(),
          transactionAddress: transaction?.address.toBase58() ?? null,
          transactionIndex,
          status: toProposalStatus(entry.proposal.status.__kind),
          approvals: entry.proposal.approved.map((address) => address.toBase58()),
          rejections: entry.proposal.rejected.map((address) => address.toBase58()),
          cancellations: entry.proposal.cancelled.map((address) =>
            address.toBase58()
          ),
          creator: transaction?.transaction.creator.toBase58() ?? null,
          accountIndex: payloadSummary.accountIndex,
          summary: payloadSummary.summary,
        } satisfies SmartAccountProposalSnapshot;
      })
      .sort((left, right) =>
        BigInt(right.transactionIndex) > BigInt(left.transactionIndex) ? 1 : -1
      );
  }

  async function fetchOverview(args: {
    settingsPda: PublicKey;
    activityLimit?: number;
  }): Promise<SmartAccountOverview> {
    const settings = await smartAccountsClient.smartAccounts.queries.fetchSettings(
      args.settingsPda
    );
    const vaults = await listVaults({
      settingsPda: args.settingsPda,
      accountUtilization: settings.accountUtilization,
      activityLimit: args.activityLimit,
    });
    const assetIndex = toAssetIndex(vaults);
    const proposals = await listProposals({
      settingsPda: args.settingsPda,
      assetIndex,
    });

    return {
      programId: smartAccountsClient.programId.toBase58(),
      settingsPda: args.settingsPda.toBase58(),
      threshold: settings.threshold,
      timeLock: settings.timeLock,
      staleTransactionIndex: toBigInt(settings.staleTransactionIndex).toString(),
      canonicalVaultAddress: vaults[0]?.address ??
        pda.getSmartAccountPda({
          programId: smartAccountsClient.programId,
          settingsPda: args.settingsPda,
          accountIndex: 0,
        })[0].toBase58(),
      vaults,
      proposals,
      fetchedAt: Date.now(),
    };
  }

  async function prepareSolTransferProposal(
    args: SmartAccountTransferProposalInput
  ) {
    const accountIndex = resolveVaultAccountIndex(args.accountIndex);
    const settings = await smartAccountsClient.smartAccounts.queries.fetchSettings(
      args.settingsPda
    );
    const transactionIndex = toBigInt(settings.transactionIndex) + BigInt(1);
    const vaultPda = pda.getSmartAccountPda({
      programId: smartAccountsClient.programId,
      settingsPda: args.settingsPda,
      accountIndex,
    })[0];
    const transactionMessage = await createVaultSolTransferMessage({
      connection: config.connection,
      vaultPda,
      destination: args.destination,
      amountLamports: args.amountLamports,
    });
    const [preparedTransaction, preparedProposal] = await Promise.all([
      smartAccountsClient.features.transactions.prepare.create(
        {
          feePayer: args.feePayer,
          rentPayer: args.feePayer,
          settingsPda: args.settingsPda,
          transactionIndex,
          creator: args.creator,
          accountIndex,
          ephemeralSigners: 0,
          transactionMessage,
          memo: args.memo,
        } as never
      ),
      smartAccountsClient.features.proposals.prepare.create(
        {
          feePayer: args.feePayer,
          rentPayer: args.feePayer,
          settingsPda: args.settingsPda,
          transactionIndex,
          creator: args.creator,
        } as never
      ),
    ]);

    return mergePreparedOperations({
      operation: "proposeSolTransfer",
      payer: args.feePayer,
      programId: smartAccountsClient.programId,
      operations: [preparedTransaction, preparedProposal],
    });
  }

  async function prepareSplTransferProposal(
    args: SmartAccountTokenTransferProposalInput
  ) {
    const accountIndex = resolveVaultAccountIndex(args.accountIndex);
    const settings = await smartAccountsClient.smartAccounts.queries.fetchSettings(
      args.settingsPda
    );
    const transactionIndex = toBigInt(settings.transactionIndex) + BigInt(1);
    const vaultPda = pda.getSmartAccountPda({
      programId: smartAccountsClient.programId,
      settingsPda: args.settingsPda,
      accountIndex,
    })[0];
    const transactionMessage = await createVaultSplTransferMessage({
      connection: config.connection,
      vaultPda,
      mint: args.mint,
      destinationOwner: args.destinationOwner,
      amount: args.amount,
      decimals: args.decimals,
      destinationTokenAccount: args.destinationTokenAccount,
      tokenProgramId: args.tokenProgramId,
      createDestinationAta: args.createDestinationAta,
    });
    const [preparedTransaction, preparedProposal] = await Promise.all([
      smartAccountsClient.features.transactions.prepare.create(
        {
          feePayer: args.feePayer,
          rentPayer: args.feePayer,
          settingsPda: args.settingsPda,
          transactionIndex,
          creator: args.creator,
          accountIndex,
          ephemeralSigners: 0,
          transactionMessage,
          memo: args.memo,
        } as never
      ),
      smartAccountsClient.features.proposals.prepare.create(
        {
          feePayer: args.feePayer,
          rentPayer: args.feePayer,
          settingsPda: args.settingsPda,
          transactionIndex,
          creator: args.creator,
        } as never
      ),
    ]);

    return mergePreparedOperations({
      operation: "proposeSplTransfer",
      payer: args.feePayer,
      programId: smartAccountsClient.programId,
      operations: [preparedTransaction, preparedProposal],
    });
  }

  function prepareApproveProposal(args: {
    settingsPda: PublicKey;
    transactionIndex: bigint;
    signer: PublicKey;
    feePayer: PublicKey;
    memo?: string;
  }) {
    return smartAccountsClient.features.proposals.prepare.approve(args as never);
  }

  function prepareRejectProposal(args: {
    settingsPda: PublicKey;
    transactionIndex: bigint;
    signer: PublicKey;
    feePayer: PublicKey;
    memo?: string;
  }) {
    return smartAccountsClient.features.proposals.prepare.reject(args as never);
  }

  function prepareExecuteProposal(args: {
    settingsPda: PublicKey;
    transactionIndex: bigint;
    signer: PublicKey;
    feePayer: PublicKey;
  }) {
    return smartAccountsClient.features.execution.prepare.executeTransaction(
      {
        ...args,
        connection: config.connection,
      } as never
    );
  }

  return {
    connection: config.connection,
    programId: smartAccountsClient.programId,
    sdk: smartAccountsClient,
    fetchVault,
    listVaults,
    listProposals,
    fetchOverview,
    prepareSolTransferProposal,
    prepareSplTransferProposal,
    prepareApproveProposal,
    prepareRejectProposal,
    prepareExecuteProposal,
  };
}
