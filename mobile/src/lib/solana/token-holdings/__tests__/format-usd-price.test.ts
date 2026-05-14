import { formatUsdSpotPrice } from "../format-usd-price";

describe("formatUsdSpotPrice", () => {
  it("keeps two decimals for dollar-priced tokens", () => {
    expect(formatUsdSpotPrice(85.73)).toBe("$85.73");
    expect(formatUsdSpotPrice(1.5)).toBe("$1.50");
  });

  it("keeps four decimals for sub-dollar tokens that still need visible movement", () => {
    expect(formatUsdSpotPrice(0.15450334808522226)).toBe("$0.1545");
  });

  it("returns an em dash when the price is unavailable", () => {
    expect(formatUsdSpotPrice(null)).toBe("—");
  });
});
