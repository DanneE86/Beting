import { describe, expect, it } from "vitest";
import {
  buildScoreMatrix,
  dcTau,
  fixBttsScoreCoherence,
  mostLikelyScoreWithBtts,
  pickOutcome,
  poissonPmf,
  probsFromMatrix,
  resolvePredictedScore,
  rhoFromAvgGoals,
} from "@/lib/poisson-model";

describe("poisson-model", () => {
  it("poissonPmf summerar till ~1 för rimlig lambda", () => {
    let sum = 0;
    for (let k = 0; k <= 10; k++) sum += poissonPmf(k, 1.4);
    expect(sum).toBeCloseTo(1, 2);
  });

  it("dcTau korrigerar låga mål", () => {
    expect(dcTau(0, 0, 1.5, 1.2, -0.05)).not.toBe(1);
    expect(dcTau(2, 3, 1.5, 1.2, -0.05)).toBe(1);
  });

  it("rhoFromAvgGoals varierar med ligasnitt", () => {
    expect(rhoFromAvgGoals(3.2)).toBe(-0.02);
    expect(rhoFromAvgGoals(2.4)).toBe(-0.1);
  });

  it("buildScoreMatrix normaliserar till sannolikhetsmassa 1", () => {
    const P = buildScoreMatrix(1.4, 1.1, -0.05, 6);
    const sum = P.flat().reduce((s, v) => s + v, 0);
    expect(sum).toBeCloseTo(1, 5);
  });

  it("probsFromMatrix ger tre utfall som summerar ~100", () => {
    const P = buildScoreMatrix(1.5, 1.0, -0.05);
    const p = probsFromMatrix(P);
    expect(p.homeWinPct + p.drawPct + p.awayWinPct).toBeCloseTo(100, 0);
  });

  it("pickOutcome väljer högst sannolikhet", () => {
    expect(pickOutcome(55, 25, 20)).toBe("H");
    expect(pickOutcome(20, 50, 30)).toBe("D");
    expect(pickOutcome(10, 20, 70)).toBe("A");
  });

  it("mostLikelyScoreWithBtts väljer 0-0 vid oavgjort och BTTS nej", () => {
    const P = buildScoreMatrix(1.1, 1.0, -0.1, 6);
    const score = mostLikelyScoreWithBtts(P, "D", "nej");
    expect(score).toBe("0-0");
  });

  it("mostLikelyScoreWithBtts väljer 1-1 vid oavgjort och BTTS ja", () => {
    const P = buildScoreMatrix(1.4, 1.2, -0.05, 6);
    const score = mostLikelyScoreWithBtts(P, "D", "ja");
    expect(score).toMatch(/^\d+-\d+$/);
    const [h, a] = score!.split("-").map(Number);
    expect(h).toBe(a);
    expect(h).toBeGreaterThan(0);
  });

  it("fixBttsScoreCoherence justerar 1-1 till 0-0 vid BTTS nej och kryss", () => {
    expect(fixBttsScoreCoherence("1-1", "nej", 32, 35, 33)).toBe("0-0");
  });

  it("fixBttsScoreCoherence justerar 2-1 till 2-0 vid BTTS nej och hemmaseger", () => {
    expect(fixBttsScoreCoherence("2-1", "nej", 55, 25, 20)).toBe("2-0");
  });

  it("resolvePredictedScore matchar BTTS-tipset mot matrisen", () => {
    const P = buildScoreMatrix(1.1, 1.0, -0.1, 6);
    const score = resolvePredictedScore({
      matrix: P,
      homeWinPct: 32,
      drawPct: 35,
      awayWinPct: 33,
      bttsCall: "nej",
      fallbackScore: "1-1",
    });
    expect(score).toBe("0-0");
  });
});
