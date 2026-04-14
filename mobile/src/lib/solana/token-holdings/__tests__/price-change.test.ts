import { derivePriceChange24hPercent } from "../price-change";

describe("derivePriceChange24hPercent", () => {
  it("returns the explicit 24h price change when present", () => {
    expect(
      derivePriceChange24hPercent({
        explicitPriceChange24hPercent: 4.06,
        chart: [
          { timestamp: 1, priceUsd: 100 },
          { timestamp: 2, priceUsd: 110 },
        ],
      }),
    ).toBe(4.06);
  });

  it("derives the 24h price change from chart data when the explicit value is missing", () => {
    expect(
      derivePriceChange24hPercent({
        explicitPriceChange24hPercent: null,
        chart: [
          { timestamp: 1, priceUsd: 100 },
          { timestamp: 2, priceUsd: 104.06 },
        ],
      }),
    ).toBeCloseTo(4.06, 6);
  });

  it("returns null when chart data cannot support the calculation", () => {
    expect(
      derivePriceChange24hPercent({
        explicitPriceChange24hPercent: null,
        chart: [],
      }),
    ).toBeNull();

    expect(
      derivePriceChange24hPercent({
        explicitPriceChange24hPercent: null,
        chart: [
          { timestamp: 1, priceUsd: 0 },
          { timestamp: 2, priceUsd: 104.06 },
        ],
      }),
    ).toBeNull();
  });
});
