import { describe, expect, it } from "vitest";
import { calibrationToAdjustments } from "@/lib/calibration";

describe("calibration", () => {
  it("returnerar null utan kalibrering", () => {
    expect(calibrationToAdjustments(null)).toBeNull();
    expect(calibrationToAdjustments(undefined)).toBeNull();
  });

  it("mappar league-kalibrering till justeringar", () => {
    const adj = calibrationToAdjustments({
      leagueId: "eng.1",
      total: 100,
      resolved: 50,
      hitRate: 0.55,
      avgBrier: 0.65,
      byConfidence: {},
      outcomeBias: { H: 0.5, D: 0.5, A: 0.5 },
      predictedBias: { H: 0.4, D: 0.3, A: 0.3 },
      actualDistribution: { H: 44, D: 26, A: 30 },
      btts: { n: 50, yes: 28, pct: 56, avgGoals: 2.7 },
      topLessons: [],
      topMistakes: [],
      topSignalsMissed: [],
      recentWrongPicks: [],
      historicalBaseline: {
        seasons: 3,
        homePct: 0.45,
        drawPct: 0.25,
        awayPct: 0.30,
        matches: 100,
        bttsPct: 0.52,
        avgGoals: 2.6,
      },
    });
    expect(adj?.historicalBaseline?.homePct).toBe(0.45);
    expect(adj?.resolved).toBe(50);
  });
});
