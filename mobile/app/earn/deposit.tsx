import { useLocalSearchParams } from "expo-router";

import { DepositProcessScreen } from "@/components/earn/DepositProcessScreen";

export default function DepositProcessRoute() {
  const { amount } = useLocalSearchParams<{ amount?: string | string[] }>();
  const raw = Array.isArray(amount) ? amount[0] : amount;
  const amountUsd = Number(raw);

  return (
    <DepositProcessScreen
      amountUsd={Number.isFinite(amountUsd) ? amountUsd : 0}
    />
  );
}
