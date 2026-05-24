import { describe, expect, it } from "vitest";
import {
  bttsProbFromLambdas,
  bttsProbFromMatrix,
  predictBtts,
} from "@/lib/btts-model";
import { buildScoreMatrix, rhoFromAvgGoals } from "@/lib/poisson-model";

describe("btts-model", () => {
  it("bttsProbFromMatrix räknar celler där båda gör mål", () => {
    const matrix = [
      [0.1, 0.05, 0.02],
      [0.15, 0.2, 0.08],
      [0.05, 0.1, 0.2],
    ];
    // i>0 && j>0: 0.2 + 0.08 + 0.1 + 0.2 = 0.58 → 58%
    expect(bttsProbFromMatrix(matrix)).toBe(58);
  });

  it("bttsProbFromLambdas ger oberoende Poisson-BTTS", () => {
    const pct = bttsProbFromLambdas(1.5, 1.2);
    expect(pct).toBeGreaterThan(40);
    expect(pct).toBeLessThan(70);
  });

  it("predictBtts returnerar call, pct och reason", () => {
    const rho = rhoFromAvgGoals(2.8);
    const matrix = buildScoreMatrix(1.6, 1.1, rho);
    const result = predictBtts({
      lamH: 1.6,
      lamA: 1.1,
      matrix,
      homeAttack: 1.5,
      homeDefense: 1.0,
      awayAttack: 1.2,
      awayDefense: 1.3,
      homeName: "Hemmalag",
      awayName: "Bortalag",
    });
    expect(["ja", "nej", "osäker"]).toContain(result.call);
    expect(result.pct).toBeGreaterThanOrEqual(8);
    expect(result.pct).toBeLessThanOrEqual(92);
    expect(result.reason).toMatch(/^BTTS /);
  });

  it("predictBtts sänker BTTS vid högt absenceScore", () => {
    const rho = rhoFromAvgGoals(2.8);
    const matrix = buildScoreMatrix(1.8, 1.6, rho);
    const base = predictBtts({
      lamH: 1.8,
      lamA: 1.6,
      matrix,
      homeAttack: 1.8,
      homeDefense: 1.0,
      awayAttack: 1.6,
      awayDefense: 1.0,
      homeName: "A",
      awayName: "B",
    });
    const injured = predictBtts({
      lamH: 1.8,
      lamA: 1.6,
      matrix,
      homeAttack: 1.8,
      homeDefense: 1.0,
      awayAttack: 1.6,
      awayDefense: 1.0,
      homeAbsenceScore: 5,
      awayAbsenceScore: 5,
      homeName: "A",
      awayName: "B",
    });
    expect(injured.pct).toBeLessThan(base.pct);
  });
});
