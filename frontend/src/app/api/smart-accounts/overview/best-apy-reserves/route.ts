import { RiskBasket } from "@loyal-labs/actions/types";

import { getCurrentBestApyReserveByStablecoin } from "@/lib/kamino/timescale-reserve-client.server";

import { withSmartAccountOverviewResponse } from "../response";

function parseRiskProfile(value: string | null): RiskBasket {
  if (!value) {
    return RiskBasket.Safe;
  }

  if (Object.values(RiskBasket).includes(value as RiskBasket)) {
    return value as RiskBasket;
  }

  throw new Error(`unsupported risk profile: ${value}`);
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const riskProfile = parseRiskProfile(url.searchParams.get("riskProfile"));

  return withSmartAccountOverviewResponse(request, {
    timingName: "smart-account-overview-best-apy-reserves",
    load: () => getCurrentBestApyReserveByStablecoin({ riskProfile }),
  });
}
