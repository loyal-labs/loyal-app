import { NextResponse } from "next/server";
import { pda } from "@loyal-labs/loyal-smart-accounts";
import { parseKaminoReserveTokenAccounts } from "@loyal-labs/smart-account-vaults";
import { PublicKey } from "@solana/web3.js";

import {
  resolveAuthenticatedPrincipalFromRequest,
  type AuthenticatedPrincipal,
} from "@/features/identity/server/auth-session";
import { getServerEnv } from "@/lib/core/config/server";
import { resolveLoyalWebSolanaEnvFromEnv } from "@/lib/core/config/solana-env-override";
import { getServerSolanaConnection } from "@/lib/solana/rpc-connection.server";
import {
  parseEarnSponsoredDepositConfirmRequestBody,
  type EarnDepositConfirmRequestBody,
  type SponsoredYieldDepositConfirmInput,
} from "@/lib/yield-optimization/earn-confirm-contracts.shared";
import {
  EarnPolicySponsoredTransactionError,
  executeSponsoredEarnPolicyTransaction,
  type SponsoredTransactionGuardContext,
} from "@/lib/yield-optimization/earn-policy-sponsored-transaction.server";

import { POST as confirmEarnDeposit } from "../route";

const EARN_DEPOSIT_VAULT_INDEX = 1;

function jsonError(
  status: number,
  code: string,
  message: string
): NextResponse {
  return NextResponse.json({ error: { code, message } }, { status });
}

function responseBodyWithSponsoredConfirmations(args: {
  deposit: Awaited<ReturnType<typeof executeSponsoredEarnPolicyTransaction>>;
  payload: unknown;
  policy: Awaited<ReturnType<typeof executeSponsoredEarnPolicyTransaction>>;
  setupPolicy?: Awaited<
    ReturnType<typeof executeSponsoredEarnPolicyTransaction>
  >;
}) {
  const payload =
    args.payload &&
    typeof args.payload === "object" &&
    !Array.isArray(args.payload)
      ? args.payload
      : { data: args.payload };

  return {
    ...payload,
    sponsoredConfirmations: {
      deposit: args.deposit,
      policy: args.policy,
      setupPolicy: args.setupPolicy ?? null,
    },
  };
}

function buildForwardedConfirmBody(args: {
  deposit: Awaited<ReturnType<typeof executeSponsoredEarnPolicyTransaction>>;
  input: SponsoredYieldDepositConfirmInput;
  policy: Awaited<ReturnType<typeof executeSponsoredEarnPolicyTransaction>>;
  setupPolicy?: Awaited<
    ReturnType<typeof executeSponsoredEarnPolicyTransaction>
  >;
}): EarnDepositConfirmRequestBody & {
  depositTransaction: string;
  policyTransaction: string;
  setupPolicyTransaction: string;
} {
  const { deposit, input, policy, setupPolicy } = args;
  return {
    cluster: input.cluster,
    confirmedSlot: deposit.confirmedSlot,
    delegatedSigner: input.delegatedSigner,
    depositMint: input.depositMint,
    depositSignature: deposit.signature,
    depositTransaction: input.depositTransaction,
    liquidityMint: input.liquidityMint,
    market: input.market,
    policyAccount: input.policyAccount,
    policyConfirmedSlot: policy.confirmedSlot,
    policyId: input.policyId.toString(),
    policyInitialization: input.policyInitialization,
    policySeed: input.policySeed.toString(),
    policySignature: policy.signature,
    policyTransaction: input.policyTransaction,
    principalAmountRaw: input.principalAmountRaw.toString(),
    settings: input.settings,
    setupPolicyAccount: input.setupPolicyAccount ?? null,
    ...(setupPolicy
      ? { setupPolicyConfirmedSlot: setupPolicy.confirmedSlot }
      : {}),
    setupPolicyId: input.setupPolicyId?.toString() ?? null,
    setupPolicySeed: input.setupPolicySeed?.toString() ?? null,
    ...(setupPolicy ? { setupPolicySignature: setupPolicy.signature } : {}),
    setupPolicyTransaction: input.setupPolicyTransaction,
    smartAccountAddress: input.smartAccountAddress,
    targetReserve: input.targetReserve,
    targetSupplyApyBps: input.targetSupplyApyBps?.toString() ?? null,
    vaultIndex: input.vaultIndex,
    vaultPubkey: input.vaultPubkey,
    walletAddress: input.walletAddress,
  };
}

function uniquePublicKeys(values: readonly PublicKey[]): PublicKey[] {
  return [
    ...new Map(values.map((value) => [value.toBase58(), value])).values(),
  ];
}

function assertSponsoredDepositPrincipal(args: {
  input: SponsoredYieldDepositConfirmInput;
  principal: AuthenticatedPrincipal;
}): void {
  const { input, principal } = args;
  if (
    input.walletAddress !== principal.walletAddress ||
    input.settings !== principal.settingsPda
  ) {
    throw new EarnPolicySponsoredTransactionError({
      status: 403,
      code: "principal_mismatch",
      message: "Sponsored Earn deposit does not belong to the active session.",
    });
  }
  if (input.vaultIndex !== EARN_DEPOSIT_VAULT_INDEX) {
    throw new EarnPolicySponsoredTransactionError({
      status: 400,
      code: "invalid_vault_index",
      message: "Sponsored Earn deposit must target the Earn vault.",
    });
  }

  const programId = new PublicKey(getServerEnv().loyalSmartAccounts.programId);
  const settingsPda = new PublicKey(principal.settingsPda);
  const [expectedVault] = pda.getSmartAccountPda({
    accountIndex: EARN_DEPOSIT_VAULT_INDEX,
    programId,
    settingsPda,
  });
  if (
    input.vaultPubkey !== expectedVault.toBase58() ||
    input.smartAccountAddress !== expectedVault.toBase58()
  ) {
    throw new EarnPolicySponsoredTransactionError({
      status: 403,
      code: "vault_mismatch",
      message:
        "Sponsored Earn deposit vault does not match the active session.",
    });
  }
}

async function resolveDepositSponsoredTransactionGuards(
  input: SponsoredYieldDepositConfirmInput
): Promise<{
  deposit: SponsoredTransactionGuardContext;
  policy: SponsoredTransactionGuardContext;
  setupPolicy: SponsoredTransactionGuardContext;
}> {
  const smartAccountsProgramId = new PublicKey(
    getServerEnv().loyalSmartAccounts.programId
  );
  const vaultPubkey = new PublicKey(input.vaultPubkey);
  const smartAccountAddress = new PublicKey(input.smartAccountAddress);
  const policyAccount = new PublicKey(input.policyAccount);
  const setupPolicyAccount = input.setupPolicyAccount
    ? new PublicKey(input.setupPolicyAccount)
    : null;
  if (input.policyInitialization === "create" && !setupPolicyAccount) {
    throw new EarnPolicySponsoredTransactionError({
      status: 400,
      code: "missing_setup_policy_account",
      message: "Sponsored Earn deposit is missing the setup policy account.",
    });
  }

  const reserveAccount = await getServerSolanaConnection(
    resolveLoyalWebSolanaEnvFromEnv(process.env)
  ).getAccountInfo(new PublicKey(input.targetReserve), "confirmed");
  if (!reserveAccount) {
    throw new EarnPolicySponsoredTransactionError({
      status: 400,
      code: "target_reserve_not_found",
      message: "Sponsored Earn deposit target reserve was not found.",
    });
  }
  const reserveAccounts = parseKaminoReserveTokenAccounts(reserveAccount.data);
  const allowedSystemTransferDestinations = uniquePublicKeys([
    vaultPubkey,
    smartAccountAddress,
  ]);

  return {
    deposit: {
      allowedAssociatedTokenMints: uniquePublicKeys([
        new PublicKey(input.depositMint),
        new PublicKey(input.liquidityMint),
        reserveAccounts.reserveCollateralMint,
      ]),
      allowedAssociatedTokenOwners: allowedSystemTransferDestinations,
      allowedSystemTransferDestinations,
    },
    policy: {
      allowedSmartAccountRentAccounts: [policyAccount],
      allowedSmartAccountsProgramId: smartAccountsProgramId,
    },
    setupPolicy: {
      allowedSmartAccountRentAccounts: setupPolicyAccount
        ? [setupPolicyAccount]
        : [],
      allowedSmartAccountsProgramId: smartAccountsProgramId,
      allowedSystemTransferDestinations,
    },
  };
}

export async function POST(request: Request) {
  const principal = await resolveAuthenticatedPrincipalFromRequest(request);

  if (!principal) {
    return jsonError(401, "unauthenticated", "No active auth session.");
  }

  let input: SponsoredYieldDepositConfirmInput;
  try {
    input = parseEarnSponsoredDepositConfirmRequestBody(await request.json());
    assertSponsoredDepositPrincipal({ input, principal });
  } catch (error) {
    if (error instanceof EarnPolicySponsoredTransactionError) {
      return jsonError(error.status, error.code, error.message);
    }
    return jsonError(
      400,
      "invalid_request",
      error instanceof Error ? error.message : "Invalid request body."
    );
  }

  let policy: Awaited<ReturnType<typeof executeSponsoredEarnPolicyTransaction>>;
  let setupPolicy:
    | Awaited<ReturnType<typeof executeSponsoredEarnPolicyTransaction>>
    | undefined;
  let deposit: Awaited<
    ReturnType<typeof executeSponsoredEarnPolicyTransaction>
  >;
  try {
    const guards = await resolveDepositSponsoredTransactionGuards(input);
    policy = await executeSponsoredEarnPolicyTransaction(
      input.policyTransaction,
      guards.policy
    );
    if (input.policyInitialization === "create") {
      setupPolicy = await executeSponsoredEarnPolicyTransaction(
        input.setupPolicyTransaction,
        guards.setupPolicy
      );
    }
    deposit = await executeSponsoredEarnPolicyTransaction(
      input.depositTransaction,
      guards.deposit
    );
  } catch (error) {
    if (error instanceof EarnPolicySponsoredTransactionError) {
      return jsonError(error.status, error.code, error.message);
    }
    throw error;
  }

  const headers = new Headers(request.headers);
  headers.set("content-type", "application/json");
  headers.delete("content-length");

  const forwardedResponse = await confirmEarnDeposit(
    new Request(request.url, {
      body: JSON.stringify(
        buildForwardedConfirmBody({ deposit, input, policy, setupPolicy })
      ),
      headers,
      method: "POST",
    })
  );
  const forwardedPayload = await forwardedResponse.json().catch(() => null);
  return NextResponse.json(
    responseBodyWithSponsoredConfirmations({
      deposit,
      payload: forwardedPayload,
      policy,
      setupPolicy,
    }),
    { status: forwardedResponse.status }
  );
}
