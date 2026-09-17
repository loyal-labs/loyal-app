import { Reserve } from "@kamino-finance/klend-sdk/dist/@codegen/klend/accounts/Reserve";
import type { AccountData } from "./rpc";
import { KLEND_PROGRAM_ID } from "../domain/kamino-obligation";
import { collateralToLiquidityRaw, storedDebtRaw } from "../domain/kamino-conversion";

import type { ConvertedAmount } from "../domain/kamino-view";
export function convertReserveAmount(account: AccountData | null, market: string, observedSlot: number,
  amount: bigint, kind: "collateral" | "debt"): ConvertedAmount {
  if (!account || account.owner !== KLEND_PROGRAM_ID || account.data.length !== Reserve.layout.span + 8) throw new Error("Unsupported or missing reserve");
  const reserve = Reserve.decode(Buffer.from(account.data));
  if (reserve.lendingMarket !== market || reserve.version.toString() !== "1") throw new Error("Reserve binding or version mismatch");
  const liquidity = reserve.liquidity;
  const decimals = Number(liquidity.mintDecimals.toString());
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 24) throw new Error("Unsupported reserve decimals");
  const age = BigInt(observedSlot) - BigInt(reserve.lastUpdate.slot.toString());
  if (age < 0n || ![0, 1].includes(reserve.lastUpdate.stale)) throw new Error("Invalid reserve update");
  const raw = kind === "debt" ? storedDebtRaw(amount) : collateralToLiquidityRaw(amount,
    BigInt(reserve.collateral.mintTotalSupply.toString()), BigInt(liquidity.availableAmount.toString()),
    BigInt(liquidity.borrowedAmountSf.toString()), BigInt(liquidity.accumulatedProtocolFeesSf.toString()),
    BigInt(liquidity.accumulatedReferrerFeesSf.toString()), BigInt(liquidity.pendingReferrerFeesSf.toString()));
  return { raw: raw.toString(), mint: liquidity.mintPubkey, decimals, observedSlot,
    lastUpdateSlot: reserve.lastUpdate.slot.toString(), freshness: reserve.lastUpdate.stale === 0 && age <= 32n ? "fresh" : "stale",
    rounding: kind === "debt" ? "up" : "down" };
}
