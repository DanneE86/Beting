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
});
