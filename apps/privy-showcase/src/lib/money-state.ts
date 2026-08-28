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
  AccountLayout,
  getAssociatedTokenAddressSync,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import type { Connection } from "@solana/web3.js";
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

export async function readDemoMoneyState(args: {
  connection: Connection;
  settings: PublicKey;
  wallet: PublicKey;
}): Promise<DemoMoneySnapshot> {
  const accounts = resolveDemoMoneyAccounts(args);
  // One RPC round-trip for the whole snapshot; this runs before and after
  // every move, so it is the hottest read in the demo.
  const keys = [
    accounts.walletUsdcAta,
    accounts.smartAccountUsdcAta,
    accounts.kaminoCollateralAta ?? accounts.kaminoObligation,
    accounts.kaminoObligation,
    accounts.kaminoReserve,
  ];
  const infos = await args.connection.getMultipleAccountsInfo(keys, "finalized");
  const tokenAmount = (info: (typeof infos)[number]) =>
    info ? AccountLayout.decode(info.data).amount : 0n;
  const walletUsdcRaw = tokenAmount(infos[0] ?? null);
  const smartAccountUsdcRaw = tokenAmount(infos[1] ?? null);
  const collateralAtaRaw = accounts.kaminoCollateralAta
    ? tokenAmount(infos[2] ?? null)
    : 0n;
  const obligationAccount = infos[3] ?? null;
  const reserveAccount = infos[4] ?? null;
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
