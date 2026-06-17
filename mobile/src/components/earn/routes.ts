import type { Href } from "expo-router";

// The deposit "process" screen — a placeholder confirmation step shown after the
// user taps Deposit in the sheet. Carries the entered USD amount so the screen
// can summarize it. The real on-chain execution + success/error screens hook in
// here later.
export function buildDepositProcessHref(amountUsd: number): Href {
  return {
    pathname: "/earn/deposit",
    params: { amount: amountUsd.toFixed(2) },
  } as Href;
}
