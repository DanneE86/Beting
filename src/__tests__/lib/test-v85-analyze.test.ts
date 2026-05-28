import { describe, expect, it } from "vitest";
import { analyzeLeg } from "../../../v86/src/analyze";
import type { AtgRace, AtgStart } from "../../../v86/src/types";

function start(
  number: number,
  name: string,
  betDistribution: number,
  winPercentage: number,
): AtgStart {
  return {
    id: `start-${number}`,
    number,
    postPosition: number,
    scratched: false,
    horse: {
      id: number,
      name,
      age: 5,
      statistics: {
        life: {
          winPercentage,
          earningsPerStart: 125_000,
          starts: 12,
        },
      },
    },
    driver: {
      firstName: "Test",
      lastName: `Driver ${number}`,
    },
    pools: {
      V85: {
        betDistribution,
      },
    },
  };
}

describe("analyzeLeg", () => {
  it("bygger häst-för-häst-rank med kort kommentar och prognosfält", () => {
    const race: AtgRace = {
      id: "race-1",
      number: 1,
      name: "Silverdivisionen",
      distance: 2140,
      startMethod: "auto",
      track: { name: "Solvalla" },
      starts: [
        start(1, "Favoriten", 44, 28),
        start(3, "Utmanaren", 21, 18),
        start(7, "Skrällen", 9, 15),
      ],
    };

    const leg = analyzeLeg(race, 1, "V85");

    expect(leg.horses).toHaveLength(3);
    expect(leg.horses[0]?.projectedRank).toBe(1);
    expect(leg.horses[0]?.projectedFinishLabel).toBeTruthy();
    expect(leg.horses[0]?.analystComment).toBeTruthy();
    expect(leg.horses.every((horse) => horse.projectedRank != null)).toBe(true);
    expect(leg.horses.every((horse) => horse.projectedFinishLabel != null)).toBe(true);
    expect(leg.horses.every((horse) => typeof horse.analystComment === "string" && horse.analystComment.length > 0)).toBe(
      true,
    );
    expect(leg.bankabilityScore).toBeGreaterThanOrEqual(0);
    expect(leg.opennessScore).toBeGreaterThanOrEqual(0);
  });

  it("låter inte strecken ändra rank eller rekommendation när övrig data är samma", () => {
    const baseStarts = [
      start(1, "Ettan", 52, 30),
      start(2, "Tvåan", 18, 22),
      start(3, "Trean", 8, 16),
    ];
    const swappedStarts = [
      start(1, "Ettan", 7, 30),
      start(2, "Tvåan", 48, 22),
      start(3, "Trean", 25, 16),
    ];

    const raceA: AtgRace = {
      id: "race-a",
      number: 1,
      name: "Klass I",
      distance: 2140,
      startMethod: "auto",
      track: { name: "Solvalla" },
      starts: baseStarts,
    };
    const raceB: AtgRace = {
      ...raceA,
      id: "race-b",
      starts: swappedStarts,
    };

    const legA = analyzeLeg(raceA, 1, "V85");
    const legB = analyzeLeg(raceB, 1, "V85");

    expect(legA.horses.map((horse) => horse.number)).toEqual(legB.horses.map((horse) => horse.number));
    expect(legA.recommendation).toBe(legB.recommendation);
    expect(legA.favorite.number).not.toBe(legB.favorite.number);
  });

  it("regel 2 använder marknadssignaler som separat profil", () => {
    const race: AtgRace = {
      id: "race-rule2",
      number: 1,
      name: "Guld",
      distance: 2140,
      startMethod: "auto",
      track: { name: "Solvalla" },
      starts: [
        start(1, "Modellhästen", 8, 34),
        start(2, "Marknadsfavoriten", 52, 24),
        start(3, "Tredjehästen", 15, 18),
      ],
    };

    const rule1 = analyzeLeg(race, 1, "V85", undefined, "rule1");
    const rule2 = analyzeLeg(race, 1, "V85", undefined, "rule2");

    expect(rule1.horses.map((horse) => horse.number)).toEqual(rule2.horses.map((horse) => horse.number));
    expect(rule2.favorite.number).toBe(2);
    expect(rule2.horses.some((horse) => horse.marketRank != null)).toBe(true);
  });
});
