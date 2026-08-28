import type { DemoMoneyState } from "./money-state";
import {
  AUTODEPOSIT_AMOUNT_RAW,
  type DemoMoveAction,
  KAMINO_DEPOSIT_AMOUNT_RAW,
  KAMINO_WITHDRAW_AMOUNT_RAW,
  WALLET_RETURN_AMOUNT_RAW,
} from "./sponsor-protocol";
import { SponsorRequestError } from "./sponsor-validation";

// Kamino's redeemable amount accrues interest continuously, so the value the
// client snapshotted and the value the server reads moments later can differ
// by a few raw units without any competing transaction. Wallet and
// smart-account token balances only change through transactions and stay
// byte-exact.
export const KAMINO_INTEREST_TOLERANCE_RAW = 4n;

function absDiff(left: bigint, right: bigint): bigint {
  return left > right ? left - right : right - left;
}

export function assertExpectedMoneyState(
  actual: Omit<DemoMoneyState, "vault">,
  expected: Omit<DemoMoneyState, "vault">
): void {
  if (
    actual.walletUsdcRaw !== expected.walletUsdcRaw ||
    actual.smartAccountUsdcRaw !== expected.smartAccountUsdcRaw ||
    absDiff(actual.kaminoUsdcRaw, expected.kaminoUsdcRaw) >
      KAMINO_INTEREST_TOLERANCE_RAW
  ) {
    throw new SponsorRequestError(
      409,
      "Money state changed. Refresh balances and try again."
    );
  }
}

export function reconcileMove(
  action: DemoMoveAction,
  before: Omit<DemoMoneyState, "vault">,
  after: Omit<DemoMoneyState, "vault">,
  signature?: string
): void {
  const smartAccountDelta = after.smartAccountUsdcRaw - before.smartAccountUsdcRaw;
  const ok =
    action === "wallet_to_smart_account"
      ? before.walletUsdcRaw - after.walletUsdcRaw === AUTODEPOSIT_AMOUNT_RAW &&
        after.smartAccountUsdcRaw - before.smartAccountUsdcRaw === AUTODEPOSIT_AMOUNT_RAW
      : action === "smart_account_to_kamino"
      ? before.smartAccountUsdcRaw - after.smartAccountUsdcRaw === KAMINO_DEPOSIT_AMOUNT_RAW &&
        after.kaminoUsdcRaw > before.kaminoUsdcRaw
      : action === "kamino_to_smart_account"
      ? smartAccountDelta >= KAMINO_WITHDRAW_AMOUNT_RAW &&
        smartAccountDelta <= KAMINO_WITHDRAW_AMOUNT_RAW + 2n &&
        after.kaminoUsdcRaw < before.kaminoUsdcRaw
      : before.smartAccountUsdcRaw - after.smartAccountUsdcRaw ===
          WALLET_RETURN_AMOUNT_RAW &&
        after.walletUsdcRaw - before.walletUsdcRaw === WALLET_RETURN_AMOUNT_RAW;
  if (!ok) {
    // The transaction already landed on-chain; keep the signature attached so
    // the caller can show what actually executed instead of a bare failure.
    throw new SponsorRequestError(
      502,
      "The transaction landed but balances do not match the fixed money movement. Refresh balances.",
      signature
    );
  }
}
