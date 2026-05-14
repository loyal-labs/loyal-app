import {
  buildTokenChartCoordinates,
  buildTokenChartPath,
  getTokenChartPointIndex,
  normalizeTokenChartTimestamp,
} from "../chart";

describe("token detail chart helpers", () => {
  it("normalizes second-based timestamps into milliseconds", () => {
    expect(normalizeTokenChartTimestamp(1_712_534_400)).toBe(1_712_534_400_000);
    expect(normalizeTokenChartTimestamp(1_712_534_400_000)).toBe(1_712_534_400_000);
  });

  it("selects the nearest chart point for a horizontal touch position", () => {
    expect(
      getTokenChartPointIndex(
        [
          { timestamp: 1, priceUsd: 10 },
          { timestamp: 2, priceUsd: 20 },
          { timestamp: 3, priceUsd: 30 },
        ],
        200,
        149,
      ),
    ).toBe(1);

    expect(
      getTokenChartPointIndex(
        [
          { timestamp: 1, priceUsd: 10 },
          { timestamp: 2, priceUsd: 20 },
          { timestamp: 3, priceUsd: 30 },
        ],
        200,
        199,
      ),
    ).toBe(2);
  });

  it("builds chart coordinates and path for rendering", () => {
    const coordinates = buildTokenChartCoordinates(
      [
        { timestamp: 1, priceUsd: 10 },
        { timestamp: 2, priceUsd: 20 },
        { timestamp: 3, priceUsd: 15 },
      ],
      200,
      100,
    );

    expect(coordinates).toEqual([
      expect.objectContaining({ x: 0, y: 100 }),
      expect.objectContaining({ x: 100, y: 0 }),
      expect.objectContaining({ x: 200, y: 50 }),
    ]);
    expect(buildTokenChartPath(coordinates)).toBe("M 0.00 100.00 L 100.00 0.00 L 200.00 50.00");
  });

  it("keeps chart points away from the top and bottom edges when insets are provided", () => {
    const coordinates = buildTokenChartCoordinates(
      [
        { timestamp: 1, priceUsd: 10 },
        { timestamp: 2, priceUsd: 20 },
        { timestamp: 3, priceUsd: 15 },
      ],
      200,
      100,
      {
        topInset: 8,
        bottomInset: 12,
      },
    );

    expect(coordinates).toEqual([
      expect.objectContaining({ x: 0, y: 88 }),
      expect.objectContaining({ x: 100, y: 8 }),
      expect.objectContaining({ x: 200, y: 48 }),
    ]);
  });
});
