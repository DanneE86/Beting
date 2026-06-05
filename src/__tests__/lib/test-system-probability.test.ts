import { describe, expect, it } from "vitest";
import { computeSystemHitOutlook, selectedHitProbability } from "../../../v86/src/system-probability";
import type { BuiltSystem, LegAnalysis } from "../../../v86/src/types";

function leg(legNum: number, horses: Array<{ number: number; estimatedWinPct: number }>): LegAnalysis {
  const scored = horses.map((h) => ({
    number: h.number,
    name: `H${h.number}`,
    driver: "Kusk",
    betDistribution: 10,
    winOdds: null,
    winPct: 0.1,
    earningsPerStart: 0,
    formScore: 50,
    valueScore: 1,
    horseScore: 0.5,
    driverScore: 0.5,
    combinedScore: h.estimatedWinPct / 100,
    formTrend: "stabil" as const,
    highlights: [],
    horseChecklist: [],
    driverChecklist: [],
    isSkrellCandidate: false,
    estimatedWinPct: h.estimatedWinPct,
    valueEdgePct: 0,
  }));
  return {
    leg: legNum,
    raceId: `r${legNum}`,
    track: "Test",
    horses: scored,
    favorite: scored[0],
    skrellSpike: null,
    recommendation: "gardering",
    bankabilityScore: 0.5,
    opennessScore: 0.3,
  };
}

describe("system-probability", () => {
  it("summerar spik och gardering till avdelningsträff", () => {
    const l = leg(1, [
      { number: 1, estimatedWinPct: 30 },
      { number: 2, estimatedWinPct: 20 },
    ]);
    expect(selectedHitProbability(l, [1])).toBeCloseTo(0.3, 2);
    expect(selectedHitProbability(l, [1, 2])).toBeCloseTo(0.5, 2);
  });

  it("beräknar helrad som produkt av avdelningar", () => {
    const legs = [
      leg(1, [{ number: 1, estimatedWinPct: 40 }]),
      leg(2, [{ number: 1, estimatedWinPct: 50 }]),
    ];
    const system: BuiltSystem = {
      gameId: "dd_test",
      gameType: "dd",
      budgetKr: 60,
      rows: 1,
      costKr: 10,
      estimatedPayoutNote: "",
      skrellSpikeLeg: null,
      selections: [
        { leg: 1, picks: [1], type: "spik" },
        { leg: 2, picks: [1], type: "spik" },
      ],
    };
    const outlook = computeSystemHitOutlook(legs, system);
    expect(outlook.fullRowHitPct).toBeCloseTo(0.2, 2);
    expect(outlook.legs).toHaveLength(2);
    expect(outlook.biggestRisk.leg).toBe(1);
  });
});
