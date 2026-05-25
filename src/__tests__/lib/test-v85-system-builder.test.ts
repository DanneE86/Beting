import { describe, expect, it } from "vitest";
import { buildSystem } from "../../../v86/src/system-builder";
import type { LegAnalysis, ScoredHorse } from "../../../v86/src/types";

function horse(
  number: number,
  betDistribution: number,
  combinedScore: number,
  valueScore = combinedScore * 2,
): ScoredHorse {
  return {
    number,
    name: `Horse ${number}`,
    driver: "Kusk",
    betDistribution,
    winOdds: null,
    winPct: 0,
    earningsPerStart: 0,
    formScore: combinedScore * 100,
    valueScore,
    horseScore: combinedScore,
    driverScore: combinedScore,
    combinedScore,
    formTrend: "stigande",
    highlights: [],
    horseChecklist: [],
    driverChecklist: [],
    isSkrellCandidate: betDistribution >= 2 && betDistribution <= 14,
  };
}

function leg(
  index: number,
  recommendation: LegAnalysis["recommendation"],
  horses: ScoredHorse[],
  favoriteNumber: number,
  skrellNumber?: number,
): LegAnalysis {
  return {
    leg: index,
    raceId: `race-${index}`,
    track: "Solvalla",
    raceName: `Avd ${index}`,
    horses,
    favorite: horses.find((item) => item.number === favoriteNumber) ?? horses[0],
    skrellSpike: skrellNumber ? horses.find((item) => item.number === skrellNumber) ?? null : null,
    recommendation,
    tipNote: "",
  };
}

describe("buildSystem", () => {
  it("tvingar exakt två spikar i V85, varav en skrällspik", () => {
    const legs: LegAnalysis[] = [
      leg(1, "spik", [horse(1, 58, 0.82), horse(2, 16, 0.56)], 1),
      leg(2, "gardering", [horse(1, 35, 0.65), horse(2, 18, 0.61), horse(3, 11, 0.58)], 1),
      leg(3, "gardering", [horse(1, 41, 0.67), horse(6, 9, 0.66, 1.9), horse(9, 7, 0.6, 1.7)], 1, 6),
      leg(4, "bred", [horse(1, 28, 0.59), horse(2, 24, 0.58), horse(5, 12, 0.57)], 1),
      leg(5, "gardering", [horse(1, 33, 0.66), horse(8, 13, 0.6)], 1),
      leg(6, "gardering", [horse(1, 31, 0.64), horse(4, 15, 0.59)], 1),
      leg(7, "gardering", [horse(1, 29, 0.62), horse(7, 12, 0.58)], 1),
      leg(8, "gardering", [horse(1, 26, 0.6), horse(3, 14, 0.57)], 1),
    ];

    const system = buildSystem("V85_test", "V85", legs, {
      budgetKr: 400,
      targetMinPayoutKr: 30000,
      forceSkrellLeg: 3,
    });

    const spikar = system.selections.filter((selection) => selection.type !== "gardering");
    expect(spikar).toHaveLength(2);
    expect(spikar.some((selection) => selection.type === "spik")).toBe(true);
    expect(spikar.some((selection) => selection.type === "skrell-spik")).toBe(true);
    expect(system.selections.find((selection) => selection.leg === 3)?.picks).toEqual([6]);
  });

  it("väljer ändå två spikar i V85 även utan explicit skrällkandidat", () => {
    const legs: LegAnalysis[] = [
      leg(1, "spik", [horse(1, 54, 0.8), horse(2, 18, 0.55)], 1),
      leg(2, "gardering", [horse(1, 32, 0.64), horse(5, 21, 0.62, 1.4)], 1),
      leg(3, "gardering", [horse(1, 30, 0.63), horse(7, 19, 0.61, 1.45)], 1),
      leg(4, "bred", [horse(1, 22, 0.57), horse(9, 17, 0.56, 1.35)], 1),
      leg(5, "gardering", [horse(1, 27, 0.6), horse(6, 20, 0.58, 1.3)], 1),
      leg(6, "gardering", [horse(1, 29, 0.61), horse(4, 18, 0.57, 1.28)], 1),
      leg(7, "gardering", [horse(1, 25, 0.59), horse(8, 16, 0.56, 1.25)], 1),
      leg(8, "gardering", [horse(1, 28, 0.6), horse(3, 15, 0.57, 1.26)], 1),
    ];

    const system = buildSystem("V85_test", "V85", legs, {
      budgetKr: 400,
      targetMinPayoutKr: 30000,
    });

    const spikar = system.selections.filter((selection) => selection.type !== "gardering");
    expect(spikar).toHaveLength(2);
    expect(spikar.some((selection) => selection.type === "skrell-spik")).toBe(true);
  });

  it("låser inte vanlig spik till marknadsfavorit när modellen föredrar annan häst", () => {
    const legs: LegAnalysis[] = [
      leg(1, "gardering", [horse(1, 41, 0.67), horse(6, 8, 0.69, 2.2), horse(9, 6, 0.63, 1.8)], 1, 6),
      leg(2, "spik", [horse(1, 44, 0.63), horse(7, 18, 0.77, 1.95), horse(4, 9, 0.6, 1.5)], 1, 4),
      leg(3, "gardering", [horse(1, 35, 0.66), horse(2, 12, 0.61)], 1),
      leg(4, "bred", [horse(1, 24, 0.55), horse(5, 17, 0.54)], 1),
      leg(5, "gardering", [horse(1, 28, 0.58), horse(8, 14, 0.55)], 1),
      leg(6, "gardering", [horse(1, 26, 0.57), horse(4, 13, 0.54)], 1),
      leg(7, "gardering", [horse(1, 25, 0.56), horse(7, 12, 0.53)], 1),
      leg(8, "gardering", [horse(1, 27, 0.57), horse(3, 11, 0.54)], 1),
    ];

    const system = buildSystem("V85_double_value", "V85", legs, {
      budgetKr: 400,
      targetMinPayoutKr: 30000,
    });

    const spikar = system.selections.filter((selection) => selection.type !== "gardering");
    expect(spikar).toHaveLength(2);
    expect(system.selections.find((selection) => selection.leg === 2)?.picks).toEqual([7]);
  });

  it("väljer två spikar även när spelprocent saknas helt", () => {
    const legs: LegAnalysis[] = Array.from({ length: 8 }, (_, i) =>
      leg(
        i + 1,
        i === 0 ? "spik" : "bred",
        [
          horse(1, 0, 0.78 - i * 0.02, 1.2),
          horse(2, 0, 0.68 - i * 0.02, 1.1),
          horse(3, 0, 0.6 - i * 0.015, 1.0),
        ],
        1,
      ),
    );

    const system = buildSystem("V85_zero_market", "V85", legs, {
      budgetKr: 400,
      targetMinPayoutKr: 30000,
    });

    const spikar = system.selections.filter((selection) => selection.type !== "gardering");
    expect(spikar).toHaveLength(2);
    expect(spikar.some((selection) => selection.type === "skrell-spik")).toBe(true);
  });

  it("tvingar inte två spikar i DD", () => {
    const legs: LegAnalysis[] = [
      leg(1, "gardering", [horse(1, 34, 0.63), horse(2, 23, 0.6)], 1),
      leg(2, "gardering", [horse(1, 36, 0.64), horse(3, 21, 0.59)], 1),
    ];

    const system = buildSystem("dd_test", "dd", legs, {
      budgetKr: 120,
      targetMinPayoutKr: 5000,
    });

    expect(system.selections.every((selection) => selection.type === "gardering")).toBe(true);
  });

  it("behåller skrällhästen i garderat lopp för bättre skrälltäckning", () => {
    const legs: LegAnalysis[] = [
      leg(
        1,
        "gardering",
        [horse(1, 39, 0.7), horse(9, 8, 0.68, 2.1), horse(4, 17, 0.66), horse(6, 12, 0.6)],
        1,
        9,
      ),
      leg(2, "gardering", [horse(1, 35, 0.64), horse(3, 22, 0.6), horse(5, 14, 0.58)], 1),
    ];

    const system = buildSystem("dd_skrell_cover", "dd", legs, {
      budgetKr: 30,
      targetMinPayoutKr: 5000,
    });

    expect(system.selections.find((selection) => selection.leg === 1)?.picks).toContain(9);
  });

  it("lägger extra hästar först i öppet lopp med skrällpotential", () => {
    const legs: LegAnalysis[] = [
      leg(
        1,
        "gardering",
        [horse(1, 42, 0.69), horse(2, 21, 0.63), horse(3, 12, 0.57), horse(4, 9, 0.54)],
        1,
      ),
      leg(
        2,
        "bred",
        [
          horse(1, 24, 0.61),
          horse(7, 18, 0.6, 1.95),
          horse(3, 18, 0.59),
          horse(5, 13, 0.58),
          horse(9, 9, 0.57),
          horse(11, 6, 0.55),
        ],
        1,
      ),
    ];

    const system = buildSystem("dd_expand_priority", "dd", legs, {
      budgetKr: 15,
      targetMinPayoutKr: 5000,
    });

    expect(system.selections.find((selection) => selection.leg === 1)?.picks).toHaveLength(3);
    expect(system.selections.find((selection) => selection.leg === 2)?.picks).toHaveLength(5);
  });

  it("håller ett hårt budgettak även när grundsystemet blir för stort", () => {
    const legs: LegAnalysis[] = [
      leg(1, "spik", [horse(1, 56, 0.82), horse(2, 18, 0.61)], 1),
      leg(2, "gardering", [horse(1, 31, 0.7), horse(2, 26, 0.69), horse(3, 18, 0.67), horse(4, 12, 0.65)], 1),
      leg(3, "gardering", [horse(1, 29, 0.68), horse(2, 24, 0.67), horse(3, 16, 0.64), horse(4, 11, 0.62)], 1),
      leg(4, "gardering", [horse(1, 28, 0.67), horse(2, 22, 0.66), horse(3, 17, 0.63), horse(4, 12, 0.61)], 1),
      leg(5, "gardering", [horse(1, 27, 0.66), horse(2, 21, 0.65), horse(3, 16, 0.62), horse(4, 13, 0.6)], 1),
      leg(6, "gardering", [horse(1, 26, 0.65), horse(2, 20, 0.64), horse(3, 15, 0.61), horse(4, 12, 0.59)], 1),
      leg(7, "gardering", [horse(1, 25, 0.64), horse(2, 19, 0.63), horse(3, 14, 0.6), horse(4, 11, 0.58)], 1),
      leg(8, "gardering", [horse(1, 24, 0.63), horse(2, 18, 0.62), horse(3, 13, 0.59), horse(4, 10, 0.57)], 1),
    ];

    const system = buildSystem("V85_budget_cap", "V85", legs, {
      budgetKr: 500,
      targetMinPayoutKr: 30000,
    });

    expect(system.costKr).toBeLessThanOrEqual(500);
  });

  it("kan lämna fler hästar kvar i öppet lopp och trimma svagare lopp inom budget", () => {
    const legs: LegAnalysis[] = [
      leg(
        1,
        "gardering",
        [horse(1, 45, 0.72), horse(2, 28, 0.64), horse(3, 8, 0.3), horse(4, 6, 0.2)],
        1,
      ),
      leg(
        2,
        "bred",
        [horse(1, 25, 0.68), horse(2, 20, 0.66), horse(3, 16, 0.64), horse(4, 12, 0.62), horse(5, 8, 0.6)],
        1,
      ),
    ];

    const system = buildSystem("dd_rebalance", "dd", legs, {
      budgetKr: 9,
      targetMinPayoutKr: 5000,
    });

    expect(system.costKr).toBeLessThanOrEqual(9);
    expect(system.selections.find((selection) => selection.leg === 1)?.picks).toHaveLength(2);
    expect(system.selections.find((selection) => selection.leg === 2)?.picks).toHaveLength(4);
  });
});
