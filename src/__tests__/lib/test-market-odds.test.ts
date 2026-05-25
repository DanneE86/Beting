import { describe, expect, it } from "vitest";

import { buildMarketLineMovement, coerceMarketOddsSnapshot } from "@/lib/market-odds";

describe("market-odds", () => {
  it("bygger linjerorelse fran opening till current", () => {
    const movement = buildMarketLineMovement(
      {
        providers: 8,
        decimalOdds: { home: 2.1, draw: 3.4, away: 3.6 },
        marketProbPct: { home: 43.1, draw: 27.2, away: 29.7 },
      },
      {
        providers: 10,
        decimalOdds: { home: 1.95, draw: 3.55, away: 4.0 },
        marketProbPct: { home: 46.4, draw: 25.5, away: 28.1 },
      },
    );

    expect(movement?.significant).toBe(true);
    expect(movement?.strongestSide).toBe("1");
    expect(movement?.homeProbDelta).toBe(3.3);
    expect(movement?.summary).toMatch(/Linjerörelse/i);
  });

  it("tolkar sparad json till snapshot", () => {
    const snapshot = coerceMarketOddsSnapshot({
      providers: 6,
      decimalOdds: { home: 2.2, draw: 3.2, away: 3.5 },
      marketProbPct: { home: 41.9, draw: 28.8, away: 29.3 },
    });
    expect(snapshot?.providers).toBe(6);
    expect(snapshot?.decimalOdds.home).toBe(2.2);
  });
});
