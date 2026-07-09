import {
  resolveLoyalClusterForSolanaEnv,
  SUBSCRIPTIONS_PROGRAM_ID,
  subscriptionRevokeDelegationData,
} from "@loyal-labs/actions";
import {
  pda,
  type PreparedLoyalSmartAccountsOperation,
} from "@loyal-labs/loyal-smart-accounts";
import {
  createSmartAccountVaultsClient,
  type SmartAccountEarnVaultRefundSnapshot,
} from "@loyal-labs/smart-account-vaults";
import type { SolanaEnv } from "@loyal-labs/solana-rpc";
import {
  PublicKey,
  TransactionInstruction,
  type Connection,
} from "@solana/web3.js";

import {
  serializePreparedEarnPolicyRefund,
  serializePreparedEarnRecurringDelegationRefund,
  serializePreparedEarnVaultRefund,
  type EarnPolicyRefundPrepareRequestBody,
  type EarnPolicyRefundPrepareResponse,
  type EarnPolicyRefundScanPolicy,
  type EarnPolicyRefundScanResponse,
  type EarnPolicyRefundVaultEntry,
} from "./earn-policy-refund-contracts.shared";
import {
  findEarnPolicyRefundDbState,
  findEarnVaultRefundDbState,
  findSingleEarnPolicyRefundDbState,
} from "./earn-policy-refund-state.server";

// Core of the policy/account refund flow, shared by the session (web) routes
// and the mobile wallet-signature twins. Callers own authentication and
// connection construction; everything here is pure scan/prepare logic.
const EARN_VAULT_INDEX = 1;

export class EarnPolicyRefundError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(args: { status: number; code: string; message: string }) {
    super(args.message);
    this.name = "EarnPolicyRefundError";
    this.status = args.status;
    this.code = args.code;
  }
}

export type EarnPolicyRefundContext = {
  connection: Connection;
  programId: PublicKey;
  settingsPda: string;
  solanaEnv: SolanaEnv;
  walletAddress: string;
};

function getBlockedReason(args: {
  activeAutodeposit: boolean;
  activeManagedVault: boolean;
  referencedByActivePosition: boolean;
}): string | null {
  if (args.referencedByActivePosition) {
    return "Active Earn position";
  }
  if (args.activeAutodeposit) {
    return "Protected recurring delegation";
  }
  if (args.activeManagedVault) {
    return "Active Earn vault policy";
  }
  return null;
}

// The vault entry is refundable only when nothing on chain or in the DB can
// still use the vault. On-chain collateral is checked first: it is the
// strongest live-position signal and holds even when the DB rows are stale.
function buildVaultRefundEntry(args: {
  dbState: {
    hasActiveAutodeposit: boolean;
    hasActiveManagedVault: boolean;
    hasActivePosition: boolean;
  };
  snapshot: SmartAccountEarnVaultRefundSnapshot;
}): EarnPolicyRefundVaultEntry {
  const { dbState, snapshot } = args;
  const holdsChainFunds = snapshot.tokenAccounts.some(
    (tokenAccount) =>
      tokenAccount.amountRaw > BigInt(0) &&
      !tokenAccount.address.equals(snapshot.vaultUsdcAta)
  );
  const blockedReason = holdsChainFunds
    ? "Vault still holds funds on chain"
    : dbState.hasActivePosition
      ? "Active Earn position"
      : dbState.hasActiveAutodeposit
        ? "Active Autodeposit"
        : dbState.hasActiveManagedVault
          ? "Active Earn vault policy"
          : null;
  const totalRefundableLamports =
    Number(snapshot.lamports) +
    snapshot.tokenAccounts.reduce(
      (total, tokenAccount) => total + tokenAccount.lamports,
      0
    );

  return {
    account: snapshot.vaultPda.toBase58(),
    blockedReason,
    canRefund: blockedReason === null && totalRefundableLamports > 0,
    lamports: Number(snapshot.lamports),
    tokenAccounts: snapshot.tokenAccounts.map((tokenAccount) => ({
      account: tokenAccount.address.toBase58(),
      amountRaw: tokenAccount.amountRaw.toString(),
      isUsdc: tokenAccount.isUsdc,
      lamports: tokenAccount.lamports,
      mint: tokenAccount.mint.toBase58(),
    })),
    totalRefundableLamports,
  };
}

function createSubscriptionRevokeDelegationInstruction(args: {
  authority: PublicKey;
  delegation: PublicKey;
}): TransactionInstruction {
  return new TransactionInstruction({
    data: Buffer.from(subscriptionRevokeDelegationData()),
    keys: [
      { isSigner: true, isWritable: true, pubkey: args.authority },
      { isSigner: false, isWritable: true, pubkey: args.delegation },
    ],
    programId: SUBSCRIPTIONS_PROGRAM_ID,
  });
}

function prepareRecurringDelegationRefund(args: {
  feePayer: PublicKey;
  recurringDelegation: PublicKey;
}): PreparedLoyalSmartAccountsOperation<string> {
  return {
    instructions: [
      createSubscriptionRevokeDelegationInstruction({
        authority: args.feePayer,
        delegation: args.recurringDelegation,
      }),
    ],
    lookupTableAccounts: [],
    operation: "earnRecurringDelegationRentRefund",
    payer: args.feePayer,
    programId: SUBSCRIPTIONS_PROGRAM_ID,
    requiresConfirmation: true,
  };
}

function parsePublicKey(value: string, label: string): PublicKey {
  try {
    return new PublicKey(value);
  } catch {
    throw new EarnPolicyRefundError({
      status: 400,
      code: "invalid_request",
      message: `${label} is not a valid public key.`,
    });
  }
}

export async function scanEarnPolicyRefunds(
  context: EarnPolicyRefundContext
): Promise<EarnPolicyRefundScanResponse> {
  const settingsPda = new PublicKey(context.settingsPda);
  const cluster = resolveLoyalClusterForSolanaEnv(context.solanaEnv);
  const client = createSmartAccountVaultsClient({
    connection: context.connection,
    programId: context.programId,
  });
  const [vaultPubkey] = pda.getSmartAccountPda({
    accountIndex: EARN_VAULT_INDEX,
    programId: context.programId,
    settingsPda,
  });

  const overview = await client.fetchPolicyOverview({
    settingsPda,
    rootSigners: [],
  });
  const policyAddresses = overview.policies.map((policy) => policy.address);
  const [accounts, dbState, vaultDbState, vaultSnapshot] = await Promise.all([
    policyAddresses.length === 0
      ? Promise.resolve([])
      : context.connection.getMultipleAccountsInfo(
          policyAddresses.map((address) => new PublicKey(address)),
          "confirmed"
        ),
    findEarnPolicyRefundDbState({
      connection: context.connection,
      policyAccounts: policyAddresses,
      settings: context.settingsPda,
      vaultPubkey: vaultPubkey.toBase58(),
      walletAddress: context.walletAddress,
    }),
    findEarnVaultRefundDbState({ settings: context.settingsPda }),
    client.fetchEarnVaultRefundSnapshot({ cluster, settingsPda }),
  ]);

  const policies: EarnPolicyRefundScanPolicy[] = overview.policies.map(
    (policy, index) => {
      const activeManagedVault = dbState.activeManagedVaultAccounts.has(
        policy.address
      );
      const activeAutodeposit = dbState.activeAutodepositAccounts.has(
        policy.address
      );
      const recurringDelegations =
        dbState.recurringDelegationsByPolicyAccount.get(policy.address) ?? [];
      const referencedByActivePosition = dbState.activePositionAccounts.has(
        policy.address
      );
      const blockedReason = getBlockedReason({
        activeAutodeposit,
        activeManagedVault,
        referencedByActivePosition,
      });

      return {
        account: policy.address,
        accountIndex: policy.accountIndex,
        activeAutodeposit,
        activeManagedVault,
        blockedReason,
        canRefund: blockedReason === null,
        dbPresent: dbState.routePolicyAccounts.has(policy.address),
        lamports: accounts[index]?.lamports ?? null,
        recurringDelegations,
        referencedByActivePosition,
        seed: policy.seed,
        state: policy.state,
      };
    }
  );

  return {
    policies,
    recurringDelegations: dbState.recurringDelegations,
    settingsPda: context.settingsPda,
    vault: buildVaultRefundEntry({
      dbState: vaultDbState,
      snapshot: vaultSnapshot,
    }),
    vaultIndex: EARN_VAULT_INDEX,
    vaultPubkey: vaultPubkey.toBase58(),
  };
}

export async function prepareEarnPolicyRefund(
  context: EarnPolicyRefundContext,
  request: EarnPolicyRefundPrepareRequestBody
): Promise<EarnPolicyRefundPrepareResponse> {
  const settingsPda = new PublicKey(context.settingsPda);
  const cluster = resolveLoyalClusterForSolanaEnv(context.solanaEnv);
  const feePayer = parsePublicKey(context.walletAddress, "walletAddress");
  const client = createSmartAccountVaultsClient({
    connection: context.connection,
    programId: context.programId,
  });
  const [vaultPubkey] = pda.getSmartAccountPda({
    accountIndex: EARN_VAULT_INDEX,
    programId: context.programId,
    settingsPda,
  });

  if (request.kind === "vault") {
    const [vaultDbState, vaultSnapshot] = await Promise.all([
      findEarnVaultRefundDbState({ settings: context.settingsPda }),
      client.fetchEarnVaultRefundSnapshot({ cluster, settingsPda }),
    ]);
    const vault = buildVaultRefundEntry({
      dbState: vaultDbState,
      snapshot: vaultSnapshot,
    });

    if (vault.blockedReason) {
      throw new EarnPolicyRefundError({
        status: 409,
        code: "vault_active",
        message: vault.blockedReason,
      });
    }
    if (!vault.canRefund) {
      throw new EarnPolicyRefundError({
        status: 409,
        code: "vault_empty",
        message: "Nothing to refund on the Earn vault.",
      });
    }

    const preparedVaultRefund = await client.prepareEarnVaultAccountsRefund({
      cluster,
      feePayer,
      settingsPda,
      walletAddress: feePayer,
    });

    return {
      preparedVaultRefund: serializePreparedEarnVaultRefund({
        estimatedRefundLamports: vault.totalRefundableLamports,
        prepared: preparedVaultRefund.prepared,
        settingsPda: context.settingsPda,
        vault,
        vaultIndex: EARN_VAULT_INDEX,
      }),
    };
  }

  if (request.kind === "recurring_delegation") {
    const recurringDelegationPubkey = parsePublicKey(
      request.recurringDelegation,
      "recurringDelegation"
    );
    const overview = await client.fetchPolicyOverview({
      settingsPda,
      rootSigners: [],
    });
    const policyAddresses = overview.policies.map((policy) => policy.address);
    const dbState = await findEarnPolicyRefundDbState({
      connection: context.connection,
      policyAccounts: policyAddresses,
      settings: context.settingsPda,
      vaultPubkey: vaultPubkey.toBase58(),
      walletAddress: context.walletAddress,
    });
    const recurringDelegation = dbState.recurringDelegations.find(
      (delegation) => delegation.account === request.recurringDelegation
    );

    if (!recurringDelegation) {
      throw new EarnPolicyRefundError({
        status: 404,
        code: "delegation_not_found",
        message: "Recurring delegation account was not found.",
      });
    }
    if (!recurringDelegation.canRefund) {
      throw new EarnPolicyRefundError({
        status: 409,
        code: "delegation_protected",
        message:
          recurringDelegation.blockedReason ??
          "Recurring delegation is not reclaimable.",
      });
    }

    const prepared = prepareRecurringDelegationRefund({
      feePayer,
      recurringDelegation: recurringDelegationPubkey,
    });

    return {
      preparedRecurringDelegationRefund:
        serializePreparedEarnRecurringDelegationRefund({
          estimatedRefundLamports: recurringDelegation.lamports,
          prepared,
          recurringDelegation,
          settingsPda: context.settingsPda,
          vaultIndex: EARN_VAULT_INDEX,
        }),
    };
  }

  const policyAccount = parsePublicKey(request.policyAccount, "policyAccount");
  const [overview, accountInfo, dbState] = await Promise.all([
    client.fetchPolicyOverview({ settingsPda, rootSigners: [] }),
    context.connection.getAccountInfo(policyAccount, "confirmed"),
    findSingleEarnPolicyRefundDbState({
      connection: context.connection,
      policyAccount: policyAccount.toBase58(),
      settings: context.settingsPda,
      vaultPubkey: vaultPubkey.toBase58(),
      walletAddress: context.walletAddress,
    }),
  ]);
  if (!accountInfo) {
    throw new EarnPolicyRefundError({
      status: 409,
      code: "policy_closed",
      message: "Policy account is already closed.",
    });
  }

  const overviewPolicy = overview.policies.find(
    (policy) => policy.address === policyAccount.toBase58()
  );
  if (!overviewPolicy) {
    throw new EarnPolicyRefundError({
      status: 403,
      code: "policy_not_owned",
      message: "Policy does not belong to this smart account.",
    });
  }

  const blockedReason = getBlockedReason(dbState);
  const policy: EarnPolicyRefundScanPolicy = {
    account: overviewPolicy.address,
    accountIndex: overviewPolicy.accountIndex,
    activeAutodeposit: dbState.activeAutodeposit,
    activeManagedVault: dbState.activeManagedVault,
    blockedReason,
    canRefund: blockedReason === null,
    dbPresent: dbState.dbPresent,
    lamports: accountInfo.lamports,
    recurringDelegations: dbState.recurringDelegations,
    referencedByActivePosition: dbState.referencedByActivePosition,
    seed: overviewPolicy.seed,
    state: overviewPolicy.state,
  };

  if (blockedReason) {
    throw new EarnPolicyRefundError({
      status: 409,
      code: "policy_active",
      message: blockedReason,
    });
  }

  const prepared = await client.prepareClosePoliciesSync({
    feePayer,
    policies: [policyAccount],
    settingsPda,
    signers: [feePayer],
  });

  return {
    preparedRefund: serializePreparedEarnPolicyRefund({
      estimatedRefundLamports: accountInfo.lamports,
      policy,
      prepared,
      settingsPda: context.settingsPda,
      vaultIndex: EARN_VAULT_INDEX,
    }),
  };
}
