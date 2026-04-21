import bs58 from "bs58";
import {
  createLoyalSmartAccountsClient,
  generated,
  pda,
  type LoyalSmartAccountsClient,
  type PreparedLoyalSmartAccountsOperation,
} from "@loyal-labs/loyal-smart-accounts";
import {
  Policy,
  Proposal,
  SettingsTransaction,
  Transaction,
  freezePreparedOperation,
  policyDiscriminator,
  proposalDiscriminator,
  settingsTransactionDiscriminator,
  toBigInt,
  transactionDiscriminator,
  transactionMessageToMultisigTransactionMessageBytes,
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
  createVaultCustomInstructionMessage,
  createVaultSolTransferMessage,
  createVaultSplTransferMessage,
  isSupportedTokenProgram,
  resolveVaultAccountIndex,
} from "./messages";
import type {
  SmartAccountOverview,
  SmartAccountCustomInstructionProposalInput,
  SmartAccountPolicyCustomInstructionProposalInput,
  SmartAccountProposalPayloadType,
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
    instructions: args.operations.flatMap(
      (operation) => operation.instructions
    ),
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
    const keys = Array.from(instruction.accountIndexes).map(
      (accountIndex: number) => ({
        pubkey: message.accountKeys[accountIndex],
        isSigner: accountIndex < message.numSigners,
        isWritable: getWritableFlags(message, accountIndex),
      })
    );

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

function summarizeSolTransferInstruction(args: {
  instruction: ReturnType<typeof compileVaultInstructions>[number];
  instructionCount: number;
}): SmartAccountProposalSummary | null {
  try {
    const decoded = SystemInstruction.decodeTransfer({
      programId: args.instruction.programId,
      keys: args.instruction.keys,
      data: args.instruction.data,
    });

    return {
      kind: "sol_transfer",
      title: "Send",
      subtitle: `to ${decoded.toPubkey.toBase58()}`,
      symbol: "SOL",
      amountUi: formatTokenAmount(BigInt(decoded.lamports), 9),
      amountRaw: BigInt(decoded.lamports).toString(),
      mint: null,
      decimals: 9,
      destination: decoded.toPubkey.toBase58(),
      programId: args.instruction.programId.toBase58(),
      instructionCount: args.instructionCount,
    };
  } catch {
    return null;
  }
}

function summarizeSplTransferInstruction(args: {
  instruction: ReturnType<typeof compileVaultInstructions>[number];
  instructionCount: number;
  assetIndex: Map<string, PortfolioPosition>;
}): SmartAccountProposalSummary | null {
  try {
    const decoded = decodeTransferCheckedInstruction(
      {
        programId: args.instruction.programId,
        keys: args.instruction.keys,
        data: args.instruction.data,
      },
      args.instruction.programId
    );
    const mint = decoded.keys.mint.pubkey.toBase58();
    const asset = findAssetMetadata(args.assetIndex, mint);

    return {
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
      programId: args.instruction.programId.toBase58(),
      instructionCount: args.instructionCount,
    };
  } catch {
    return null;
  }
}

function summarizeSettingsTransaction(
  settingsTransaction: SettingsTransaction
): SmartAccountProposalSummary {
  const actionKinds = settingsTransaction.actions.map(
    (action) => action.__kind
  );
  const title =
    actionKinds.length === 1
      ? actionKinds[0].replace(/([a-z])([A-Z])/g, "$1 $2")
      : "Settings changes";

  return {
    kind: "settings_change",
    title,
    subtitle:
      actionKinds.length === 0 ? "No settings actions" : actionKinds.join(", "),
    symbol: null,
    amountUi: null,
    amountRaw: null,
    mint: null,
    decimals: null,
    destination: null,
    programId: null,
    instructionCount: actionKinds.length,
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

  for (const instruction of instructions) {
    if (instruction.programId.equals(SystemProgram.programId)) {
      const summary = summarizeSolTransferInstruction({
        instruction,
        instructionCount: instructions.length,
      });

      if (summary) {
        return {
          accountIndex: details.accountIndex,
          summary,
        };
      }
    }

    if (isSupportedTokenProgram(instruction.programId)) {
      const summary = summarizeSplTransferInstruction({
        instruction,
        instructionCount: instructions.length,
        assetIndex: args.assetIndex,
      });

      if (summary) {
        return {
          accountIndex: details.accountIndex,
          summary,
        };
      }
    }
  }

  const firstInstruction = instructions[0] ?? null;

  if (!firstInstruction) {
    return {
      accountIndex: details.accountIndex,
      summary: summarizeUnknownInstruction({
        programId: null,
        instructionCount: 0,
      }),
    };
  }

  return {
    accountIndex: details.accountIndex,
    summary: summarizeUnknownInstruction({
      programId: firstInstruction.programId,
      instructionCount: instructions.length,
    }),
  };
}

function createProposalFilters(
  settingsPda: PublicKey
): GetProgramAccountsFilter[] {
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

function createSettingsTransactionFilters(
  settingsPda: PublicKey
): GetProgramAccountsFilter[] {
  return [
    {
      memcmp: {
        offset: 0,
        bytes: bs58.encode(Buffer.from(settingsTransactionDiscriminator)),
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

function createPolicyFilters(
  settingsPda: PublicKey
): GetProgramAccountsFilter[] {
  return [
    {
      memcmp: {
        offset: 0,
        bytes: bs58.encode(Buffer.from(policyDiscriminator)),
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

function deserializePolicyAccount(args: {
  pubkey: PublicKey;
  account: AccountInfo<Buffer>;
}) {
  const [policy] = Policy.fromAccountInfo(args.account);
  return {
    address: args.pubkey,
    policy,
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

function deserializeSettingsTransactionAccount(args: {
  pubkey: PublicKey;
  account: AccountInfo<Buffer>;
}) {
  const [settingsTransaction] = SettingsTransaction.fromAccountInfo(
    args.account
  );
  return {
    address: args.pubkey,
    settingsTransaction,
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

function toConsensusTransactionKey(args: {
  consensusPda: PublicKey;
  transactionIndex: string;
}) {
  return `${args.consensusPda.toBase58()}:${args.transactionIndex}`;
}

function dedupePublicKeys(keys: readonly PublicKey[]): PublicKey[] {
  const unique = new Map<string, PublicKey>();

  for (const key of keys) {
    unique.set(key.toBase58(), key);
  }

  return [...unique.values()];
}

function getSettingsTransactionExecutionAccounts(args: {
  settingsPda: PublicKey;
  settingsTransaction: SettingsTransaction;
  programId: PublicKey;
}): {
  spendingLimits: PublicKey[];
  policies: PublicKey[];
} {
  const spendingLimits: PublicKey[] = [];
  const policies: PublicKey[] = [];

  for (const action of args.settingsTransaction.actions) {
    switch (action.__kind) {
      case "AddSpendingLimit":
        spendingLimits.push(
          pda.getSpendingLimitPda({
            programId: args.programId,
            settingsPda: args.settingsPda,
            seed: action.seed,
          })[0]
        );
        break;
      case "RemoveSpendingLimit":
        spendingLimits.push(action.spendingLimit);
        break;
      case "PolicyCreate":
        policies.push(
          pda.getPolicyPda({
            programId: args.programId,
            settingsPda: args.settingsPda,
            policySeed: toBigInt(action.seed) as unknown as number,
          })[0]
        );
        break;
      case "PolicyUpdate":
      case "PolicyRemove":
        policies.push(action.policy);
        break;
    }
  }

  return {
    spendingLimits: dedupePublicKeys(spendingLimits),
    policies: dedupePublicKeys(policies),
  };
}

export type SmartAccountVaultsClient = ReturnType<
  typeof createSmartAccountVaultsClient
>;

export function createSmartAccountVaultsClient(
  config: SmartAccountVaultsClientConfig
) {
  const smartAccountsClient: LoyalSmartAccountsClient =
    createLoyalSmartAccountsClient({
      connection: config.connection,
      programId: config.programId,
      defaultCommitment: "confirmed",
    });
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
    const policyAccounts = await config.connection.getProgramAccounts(
      smartAccountsClient.programId,
      {
        commitment: "confirmed",
        filters: createPolicyFilters(args.settingsPda),
      }
    );
    const policyConsensusPdas = policyAccounts.map(
      (account) => deserializePolicyAccount(account).address
    );
    const consensusPdas = dedupePublicKeys([
      args.settingsPda,
      ...policyConsensusPdas,
    ]);
    const [
      proposalAccountGroups,
      transactionAccountGroups,
      settingsTransactionAccounts,
    ] = await Promise.all([
      Promise.all(
        consensusPdas.map((consensusPda) =>
          config.connection.getProgramAccounts(smartAccountsClient.programId, {
            commitment: "confirmed",
            filters: createProposalFilters(consensusPda),
          })
        )
      ),
      Promise.all(
        consensusPdas.map((consensusPda) =>
          config.connection.getProgramAccounts(smartAccountsClient.programId, {
            commitment: "confirmed",
            filters: createTransactionFilters(consensusPda),
          })
        )
      ),
      config.connection.getProgramAccounts(smartAccountsClient.programId, {
        commitment: "confirmed",
        filters: createSettingsTransactionFilters(args.settingsPda),
      }),
    ]);
    const proposalAccounts = proposalAccountGroups.flat();
    const transactionAccounts = transactionAccountGroups.flat();
    const transactionsByKey = new Map(
      transactionAccounts.map((account) => {
        const deserialized = deserializeTransactionAccount(account);
        const transactionIndex = toBigInt(
          deserialized.transaction.index
        ).toString();
        return [
          toConsensusTransactionKey({
            consensusPda: deserialized.transaction.consensusAccount,
            transactionIndex,
          }),
          deserialized,
        ];
      })
    );
    const settingsTransactionsByKey = new Map(
      settingsTransactionAccounts.map((account) => {
        const deserialized = deserializeSettingsTransactionAccount(account);
        const transactionIndex = toBigInt(
          deserialized.settingsTransaction.index
        ).toString();
        return [
          toConsensusTransactionKey({
            consensusPda: deserialized.settingsTransaction.settings,
            transactionIndex,
          }),
          deserialized,
        ];
      })
    );
    const assetIndex = args.assetIndex ?? new Map<string, PortfolioPosition>();

    return proposalAccounts
      .map((account) => deserializeProposalAccount(account))
      .map((entry) => {
        const transactionIndex = toBigInt(
          entry.proposal.transactionIndex
        ).toString();
        const consensusPda = entry.proposal.settings;
        const transactionKey = toConsensusTransactionKey({
          consensusPda,
          transactionIndex,
        });
        const transaction = transactionsByKey.get(transactionKey) ?? null;
        const settingsTransaction =
          settingsTransactionsByKey.get(transactionKey) ?? null;
        let payloadType: SmartAccountProposalPayloadType = "unknown";
        let transactionAddress: string | null = null;
        let creator: string | null = null;
        let payloadSummary: {
          summary: SmartAccountProposalSummary;
          accountIndex: number | null;
        } = {
          accountIndex: null,
          summary: summarizeUnknownInstruction({
            programId: null,
            instructionCount: 0,
          }),
        };

        if (transaction) {
          payloadType =
            transaction.transaction.payload.__kind === "PolicyPayload"
              ? "policy_transaction"
              : "transaction";
          transactionAddress = transaction.address.toBase58();
          creator = transaction.transaction.creator.toBase58();
          payloadSummary = summarizeTransactionPayload({
            payload: transaction.transaction.payload,
            assetIndex,
          });
        } else if (settingsTransaction) {
          payloadType = "settings_transaction";
          transactionAddress = settingsTransaction.address.toBase58();
          creator = settingsTransaction.settingsTransaction.creator.toBase58();
          payloadSummary = {
            accountIndex: null,
            summary: summarizeSettingsTransaction(
              settingsTransaction.settingsTransaction
            ),
          };
        }

        return {
          proposalAddress: entry.address.toBase58(),
          transactionAddress,
          consensusAddress: consensusPda.toBase58(),
          transactionIndex,
          payloadType,
          status: toProposalStatus(entry.proposal.status.__kind),
          approvals: entry.proposal.approved.map((address) =>
            address.toBase58()
          ),
          rejections: entry.proposal.rejected.map((address) =>
            address.toBase58()
          ),
          cancellations: entry.proposal.cancelled.map((address) =>
            address.toBase58()
          ),
          creator,
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
    const settings =
      await smartAccountsClient.smartAccounts.queries.fetchSettings(
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
      staleTransactionIndex: toBigInt(
        settings.staleTransactionIndex
      ).toString(),
      canonicalVaultAddress:
        vaults[0]?.address ??
        pda
          .getSmartAccountPda({
            programId: smartAccountsClient.programId,
            settingsPda: args.settingsPda,
            accountIndex: 0,
          })[0]
          .toBase58(),
      vaults,
      proposals,
      fetchedAt: Date.now(),
    };
  }

  async function prepareSolTransferProposal(
    args: SmartAccountTransferProposalInput
  ) {
    const accountIndex = resolveVaultAccountIndex(args.accountIndex);
    const settings =
      await smartAccountsClient.smartAccounts.queries.fetchSettings(
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
      smartAccountsClient.features.transactions.prepare.create({
        feePayer: args.feePayer,
        rentPayer: args.feePayer,
        settingsPda: args.settingsPda,
        transactionIndex,
        creator: args.creator,
        accountIndex,
        ephemeralSigners: 0,
        transactionMessage,
        memo: args.memo,
      } as never),
      smartAccountsClient.features.proposals.prepare.create({
        feePayer: args.feePayer,
        rentPayer: args.feePayer,
        settingsPda: args.settingsPda,
        transactionIndex,
        creator: args.creator,
      } as never),
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
    const settings =
      await smartAccountsClient.smartAccounts.queries.fetchSettings(
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
      smartAccountsClient.features.transactions.prepare.create({
        feePayer: args.feePayer,
        rentPayer: args.feePayer,
        settingsPda: args.settingsPda,
        transactionIndex,
        creator: args.creator,
        accountIndex,
        ephemeralSigners: 0,
        transactionMessage,
        memo: args.memo,
      } as never),
      smartAccountsClient.features.proposals.prepare.create({
        feePayer: args.feePayer,
        rentPayer: args.feePayer,
        settingsPda: args.settingsPda,
        transactionIndex,
        creator: args.creator,
      } as never),
    ]);

    return mergePreparedOperations({
      operation: "proposeSplTransfer",
      payer: args.feePayer,
      programId: smartAccountsClient.programId,
      operations: [preparedTransaction, preparedProposal],
    });
  }

  async function prepareCustomInstructionProposal(
    args: SmartAccountCustomInstructionProposalInput
  ) {
    if (args.instructions.length === 0) {
      throw new Error(
        "Custom instruction proposal requires at least one instruction."
      );
    }

    const accountIndex = resolveVaultAccountIndex(args.accountIndex);
    const settings =
      await smartAccountsClient.smartAccounts.queries.fetchSettings(
        args.settingsPda
      );
    const transactionIndex = toBigInt(settings.transactionIndex) + BigInt(1);
    const vaultPda = pda.getSmartAccountPda({
      programId: smartAccountsClient.programId,
      settingsPda: args.settingsPda,
      accountIndex,
    })[0];
    const transactionMessage = await createVaultCustomInstructionMessage({
      connection: config.connection,
      vaultPda,
      instructions: args.instructions,
    });
    const addressLookupTableAccounts = dedupeLookupTableAccounts(
      args.addressLookupTableAccounts ?? []
    );
    const [preparedTransaction, preparedProposal] = await Promise.all([
      smartAccountsClient.features.transactions.prepare.create({
        feePayer: args.feePayer,
        rentPayer: args.feePayer,
        settingsPda: args.settingsPda,
        transactionIndex,
        creator: args.creator,
        accountIndex,
        ephemeralSigners: 0,
        transactionMessage,
        addressLookupTableAccounts,
        memo: args.memo,
      } as never),
      smartAccountsClient.features.proposals.prepare.create({
        feePayer: args.feePayer,
        rentPayer: args.feePayer,
        settingsPda: args.settingsPda,
        transactionIndex,
        creator: args.creator,
      } as never),
    ]);

    return mergePreparedOperations({
      operation: "proposeCustomInstructions",
      payer: args.feePayer,
      programId: smartAccountsClient.programId,
      operations: [preparedTransaction, preparedProposal],
    });
  }

  async function preparePolicyCustomInstructionProposal(
    args: SmartAccountPolicyCustomInstructionProposalInput
  ) {
    if (args.instructions.length === 0) {
      throw new Error(
        "Policy custom instruction proposal requires at least one instruction."
      );
    }

    const accountIndex = resolveVaultAccountIndex(args.accountIndex);
    const policy = await smartAccountsClient.policies.queries.fetchPolicy(
      args.policyPda
    );
    const settingsPda = policy.settings;
    const transactionIndex = toBigInt(policy.transactionIndex) + BigInt(1);
    const vaultPda = pda.getSmartAccountPda({
      programId: smartAccountsClient.programId,
      settingsPda,
      accountIndex,
    })[0];
    const transactionMessage = await createVaultCustomInstructionMessage({
      connection: config.connection,
      vaultPda,
      instructions: args.instructions,
    });
    const addressLookupTableAccounts = dedupeLookupTableAccounts(
      args.addressLookupTableAccounts ?? []
    );
    const { transactionMessageBytes } =
      transactionMessageToMultisigTransactionMessageBytes({
        message: transactionMessage,
        addressLookupTableAccounts,
        smartAccountPda: vaultPda,
      });
    const instructionConstraintIndices =
      args.instructionConstraintIndices ??
      new Uint8Array(args.instructions.map(() => 0));
    if (instructionConstraintIndices.length !== args.instructions.length) {
      throw new Error(
        "instructionConstraintIndices length must match instructions length."
      );
    }
    const policyPayload: generated.PolicyPayload = {
      __kind: "ProgramInteraction",
      fields: [
        {
          instructionConstraintIndices,
          transactionPayload: {
            __kind: "AsyncTransaction",
            fields: [
              {
                accountIndex,
                ephemeralSigners: 0,
                transactionMessage: transactionMessageBytes,
                memo: args.memo ?? null,
              },
            ],
          },
        },
      ],
    };
    const [preparedTransaction, preparedProposal] = await Promise.all([
      smartAccountsClient.features.policies.prepare.createTransaction({
        feePayer: args.feePayer,
        rentPayer: args.feePayer,
        policy: args.policyPda,
        transactionIndex,
        creator: args.creator,
        accountIndex,
        policyPayload,
      } as never),
      smartAccountsClient.features.proposals.prepare.create({
        feePayer: args.feePayer,
        rentPayer: args.feePayer,
        settingsPda: args.policyPda,
        transactionIndex,
        creator: args.creator,
      } as never),
    ]);

    return mergePreparedOperations({
      operation: "proposePolicyCustomInstructions",
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
    return smartAccountsClient.features.proposals.prepare.approve({
      ...args,
      programId: smartAccountsClient.programId,
    } as never);
  }

  function prepareRejectProposal(args: {
    settingsPda: PublicKey;
    transactionIndex: bigint;
    signer: PublicKey;
    feePayer: PublicKey;
    memo?: string;
  }) {
    return smartAccountsClient.features.proposals.prepare.reject({
      ...args,
      programId: smartAccountsClient.programId,
    } as never);
  }

  function prepareExecuteProposal(args: {
    settingsPda: PublicKey;
    transactionIndex: bigint;
    signer: PublicKey;
    feePayer: PublicKey;
  }) {
    return smartAccountsClient.features.execution.prepare.executeTransaction({
      ...args,
      connection: config.connection,
      programId: smartAccountsClient.programId,
    } as never);
  }

  async function prepareExecuteSettingsProposal(args: {
    settingsPda: PublicKey;
    transactionIndex: bigint;
    signer: PublicKey;
    feePayer: PublicKey;
  }) {
    const transactionPda = pda.getTransactionPda({
      programId: smartAccountsClient.programId,
      settingsPda: args.settingsPda,
      transactionIndex: args.transactionIndex,
    })[0];
    const settingsTransaction =
      await smartAccountsClient.execution.queries.fetchSettingsTransaction(
        transactionPda
      );
    const executionAccounts = getSettingsTransactionExecutionAccounts({
      settingsPda: args.settingsPda,
      settingsTransaction,
      programId: smartAccountsClient.programId,
    });

    return smartAccountsClient.features.execution.prepare.executeSettingsTransaction(
      {
        ...args,
        rentPayer: args.feePayer,
        spendingLimits: executionAccounts.spendingLimits.length
          ? executionAccounts.spendingLimits
          : undefined,
        policies: executionAccounts.policies.length
          ? executionAccounts.policies
          : undefined,
        programId: smartAccountsClient.programId,
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
    prepareCustomInstructionProposal,
    preparePolicyCustomInstructionProposal,
    prepareApproveProposal,
    prepareRejectProposal,
    prepareExecuteProposal,
    prepareExecuteSettingsProposal,
  };
}
