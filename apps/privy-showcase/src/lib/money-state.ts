import { getKaminoUsdcEarnTargetForCluster } from "@loyal-labs/actions";
import { pda } from "@loyal-labs/loyal-smart-accounts";
import {
  calculateKaminoRedeemableLiquidityAmountRaw,
  deriveKaminoVanillaObligation,
  type KaminoReserveSnapshot,
  parseKaminoObligationDepositedCollateralAmountRaw,
  parseKaminoReserveSnapshot,
  resolveEarnUsdcVaultTokenAccounts,
} from "@loyal-labs/smart-account-vaults";
import {
  getAssociatedTokenAddressSync,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import type { Commitment, Connection } from "@solana/web3.js";
import { PublicKey } from "@solana/web3.js";
import {
  CANONICAL_USDC_MINT,
  DEMO_CLUSTER,
  EARN_VAULT_INDEX,
  SQUADS_PROGRAM_ID,
} from "./constants";

export type DemoMoneyState = {
  kaminoUsdcRaw: bigint;
  smartAccountUsdcRaw: bigint;
  vault: PublicKey;
  walletUsdcRaw: bigint;
};

export type DemoMoneySnapshot = DemoMoneyState & {
  kaminoCollateralRaw: bigint;
  kaminoReserveSnapshot: KaminoReserveSnapshot;
};

export type DemoMoneyAccounts = {
  kaminoCollateralAta: PublicKey | null;
  kaminoObligation: PublicKey;
  kaminoReserve: PublicKey;
  smartAccountUsdcAta: PublicKey;
  vault: PublicKey;
  walletUsdcAta: PublicKey;
};

export function resolveWalletUsdcAccount(wallet: PublicKey): PublicKey {
  return getAssociatedTokenAddressSync(
    CANONICAL_USDC_MINT,
    wallet,
    false,
    TOKEN_PROGRAM_ID
  );
}

export function resolveDemoMoneyAccounts(args: {
  settings: PublicKey;
  wallet: PublicKey;
}): DemoMoneyAccounts {
  const vault = pda.getSmartAccountPda({
    accountIndex: EARN_VAULT_INDEX,
    programId: SQUADS_PROGRAM_ID,
    settingsPda: args.settings,
  })[0];
  const vaultAccounts = resolveEarnUsdcVaultTokenAccounts({
    cluster: DEMO_CLUSTER,
    vaultPda: vault,
  });
  const target = getKaminoUsdcEarnTargetForCluster(DEMO_CLUSTER);

  return {
    kaminoCollateralAta: vaultAccounts.collateralAta,
    kaminoObligation: deriveKaminoVanillaObligation(
      vault,
      target.market,
      target.lendProgramId
    ),
    kaminoReserve: target.reserve,
    smartAccountUsdcAta: vaultAccounts.usdcAta,
    vault,
    walletUsdcAta: resolveWalletUsdcAccount(args.wallet),
  };
}

async function tokenBalanceOrZero(
  connection: Connection,
  account: PublicKey,
  commitment: Commitment
): Promise<bigint> {
  try {
    const balance = await connection.getTokenAccountBalance(account, commitment);
    return BigInt(balance.value.amount);
  } catch (error) {
    if (
      error instanceof Error &&
      error.message.toLowerCase().includes("could not find account")
    ) {
      return 0n;
    }
    throw error;
  }
}

export async function readDemoMoneyState(args: {
  commitment?: Commitment;
  connection: Connection;
  settings: PublicKey;
  wallet: PublicKey;
}): Promise<DemoMoneySnapshot> {
  // The in-flow pipeline reads at "confirmed" so each hop can chain without
  // waiting for finalization; the verify:demo auditor passes "finalized".
  const commitment = args.commitment ?? "confirmed";
  const accounts = resolveDemoMoneyAccounts(args);
  const [
    walletUsdcRaw,
    smartAccountUsdcRaw,
    collateralAtaRaw,
    obligationAccount,
    reserveAccount,
  ] =
    await Promise.all([
      tokenBalanceOrZero(args.connection, accounts.walletUsdcAta, commitment),
      tokenBalanceOrZero(args.connection, accounts.smartAccountUsdcAta, commitment),
      accounts.kaminoCollateralAta
        ? tokenBalanceOrZero(args.connection, accounts.kaminoCollateralAta, commitment)
        : Promise.resolve(0n),
      args.connection.getAccountInfo(accounts.kaminoObligation, commitment),
      args.connection.getAccountInfo(accounts.kaminoReserve, commitment),
    ]);
  if (!reserveAccount) {
    throw new Error("Kamino Main USDC reserve is unavailable.");
  }
  const kaminoReserveSnapshot = parseKaminoReserveSnapshot(reserveAccount.data);
  const obligationCollateralRaw = obligationAccount
    ? parseKaminoObligationDepositedCollateralAmountRaw({
        data: obligationAccount.data,
        reserve: accounts.kaminoReserve,
      })
    : 0n;
  const collateralRaw = collateralAtaRaw + obligationCollateralRaw;
  const kaminoUsdcRaw = calculateKaminoRedeemableLiquidityAmountRaw({
    collateralAmountRaw: collateralRaw,
    snapshot: kaminoReserveSnapshot,
  });

  return {
    kaminoCollateralRaw: collateralRaw,
    kaminoReserveSnapshot,
    kaminoUsdcRaw,
    smartAccountUsdcRaw,
    vault: accounts.vault,
    walletUsdcRaw,
  };
}
