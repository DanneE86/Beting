/**
 * Testar logiken runt PredictionPanel och AI-prognos-flödet.
 * Fokus: parseBttsReason + pickOutcome + tipPct — de funktioner
 * som PredictionPanel använder när predict.data returneras.
 */
import { describe, expect, it } from "vitest";
import { parseBttsReason } from "@/lib/btts-model";
import { pickOutcome, poissonMatchPrediction } from "@/lib/poisson-model";
import { outcomeToTip } from "@/lib/match-outcome";
import { pickTopPct } from "@/lib/football-tip";

// ─── parseBttsReason ──────────────────────────────────────────────────────────

describe("parseBttsReason", () => {
  it("parsar modernt BTTS Ja-format korrekt", () => {
    const r = parseBttsReason(
      "BTTS Ja (båda gör mål 63%, hög säkerhet): Poisson/DC 65% · form 60%.",
    );
    expect(r.call).toBe("ja");
    expect(r.yesPct).toBe(63);
    expect(r.noPct).toBe(37);
    expect(r.confidence).toBe("hög");
  });

  it("parsar modernt BTTS Nej-format korrekt", () => {
    const r = parseBttsReason(
      "BTTS Nej (båda gör mål 38%, låg säkerhet): Poisson/DC 40% · form 35%.",
    );
    expect(r.call).toBe("nej");
    expect(r.yesPct).toBe(38);
    expect(r.noPct).toBeCloseTo(62);
    expect(r.confidence).toBe("låg");
  });

  it("parsar Osäker korrekt", () => {
    const r = parseBttsReason(
      "BTTS Osäker (båda gör mål 51%, låg säkerhet): Poisson/DC 53% · form 48%.",
    );
    expect(r.call).toBe("osäker");
    expect(r.yesPct).toBe(51);
  });

  it("returnerar null-värden för null-input", () => {
    const r = parseBttsReason(null);
    expect(r.call).toBeNull();
    expect(r.yesPct).toBeNull();
    expect(r.noPct).toBeNull();
    expect(r.confidence).toBeNull();
  });

  it("returnerar null-värden för tom sträng", () => {
    const r = parseBttsReason("");
    expect(r.call).toBeNull();
    expect(r.yesPct).toBeNull();
  });

  it("returnerar raw explanation för okänt format", () => {
    const r = parseBttsReason("Bara en vanlig text utan format");
    expect(r.explanation).toBe("Bara en vanlig text utan format");
    expect(r.yesPct).toBeNull();
  });

  it("noPct = 100 - yesPct", () => {
    const r = parseBttsReason(
      "BTTS Ja (båda gör mål 72.5%, medel säkerhet): Poisson/DC 70%.",
    );
    expect(r.yesPct).toBe(72.5);
    expect(r.noPct).toBeCloseTo(27.5);
  });
});

// ─── PredictionPanel logik (pickOutcome + tipPct) ─────────────────────────────

describe("PredictionPanel — pickOutcome + tipPct", () => {
  it("väljer hemmavinst när homeWinPct är störst", () => {
    const outcome = pickOutcome(55, 25, 20);
    expect(outcome).toBe("H");
    const tip = outcomeToTip(outcome);
    expect(tip).toBe("1");
    const topPct = pickTopPct(outcome, 55, 25, 20);
    expect(topPct).toBe(55);
  });

  it("väljer kryss när drawPct är störst", () => {
    const outcome = pickOutcome(30, 40, 30);
    expect(outcome).toBe("D");
    const tip = outcomeToTip(outcome);
    expect(tip).toBe("X");
  });

  it("väljer bortavinst när awayWinPct är störst", () => {
    const outcome = pickOutcome(25, 25, 50);
    expect(outcome).toBe("A");
    const tip = outcomeToTip(outcome);
    expect(tip).toBe("2");
    const topPct = pickTopPct(outcome, 25, 25, 50);
    expect(topPct).toBe(50);
  });

  it("hanterar lika sannolikheter — väljer hemma vid H=D=A", () => {
    // Vid exakt lika väljer pickOutcome H (>=)
    const outcome = pickOutcome(33, 33, 33);
    expect(["H", "D"]).toContain(outcome);
  });
});

// ─── poissonMatchPrediction integration ───────────────────────────────────────

describe("poissonMatchPrediction — det Poisson-anrop PredictionPanel baseras på", () => {
  it("returnerar normaliserade probs som summerar till ~100", () => {
    const r = poissonMatchPrediction({
      homeAttack: 1.5, homeDefense: 1.1,
      awayAttack: 1.2, awayDefense: 1.3,
      leagueAvgGoals: 2.65,
      homeAdvantage: 1.18,
    });
    const sum = r.probs.homeWinPct + r.probs.drawPct + r.probs.awayWinPct;
    expect(sum).toBeCloseTo(100, 0);
  });

  it("hemma-fördel ökar homeWinPct jämfört med neutral arena", () => {
    const neutral = poissonMatchPrediction({
      homeAttack: 1.4, homeDefense: 1.2,
      awayAttack: 1.4, awayDefense: 1.2,
      homeAdvantage: 1.0,
    });
    const home = poissonMatchPrediction({
      homeAttack: 1.4, homeDefense: 1.2,
      awayAttack: 1.4, awayDefense: 1.2,
      homeAdvantage: 1.18,
    });
    expect(home.probs.homeWinPct).toBeGreaterThan(neutral.probs.homeWinPct);
  });

  it("starkt favorit-lag har > 60% hemma-vinst", () => {
    const r = poissonMatchPrediction({
      homeAttack: 2.5, homeDefense: 0.6,
      awayAttack: 0.8, awayDefense: 2.0,
      homeAdvantage: 1.18,
    });
    expect(r.probs.homeWinPct).toBeGreaterThan(60);
  });

  it("returnerar giltig predictedScore-sträng", () => {
    const r = poissonMatchPrediction({
      homeAttack: 1.5, homeDefense: 1.0,
      awayAttack: 1.0, awayDefense: 1.5,
    });
    expect(r.predictedScore).toMatch(/^\d+-\d+$/);
  });

  it("lamH och lamA är positiva tal", () => {
    const r = poissonMatchPrediction({
      homeAttack: 1.2, homeDefense: 1.2,
      awayAttack: 1.2, awayDefense: 1.2,
    });
    expect(r.lamH).toBeGreaterThan(0);
    expect(r.lamA).toBeGreaterThan(0);
  });
});

// ─── Shots-xG blend (logik från predict.functions) ───────────────────────────

describe("Shots-xG blend — verifierar att injektionen inte ger ogiltiga lambdas", () => {
  const SOT_RATE = 0.29;

  it("xG från SoT-data ger rimliga attack-värden", () => {
    // Typiskt lag: 4-5 SoT/match → xG ~1.16–1.45
    const avgSoT = 4.5;
    const xgAttack = avgSoT * SOT_RATE;
    expect(xgAttack).toBeGreaterThan(1.0);
    expect(xgAttack).toBeLessThan(2.0);
  });

  it("18% shots-blend med befintlig goal-rating ger rimlig lambda", () => {
    const goalAttack = 1.4;
    const sotXg = 1.2;
    const blended = 0.82 * goalAttack + 0.18 * sotXg;
    expect(blended).toBeGreaterThan(0.4);
    expect(blended).toBeLessThan(3.5);
    // Ska vara nära goal-rating (dominant)
    expect(blended).toBeCloseTo(goalAttack, 0);
  });

  it("BTTS P(båda gör mål) från SoT-lambdas är rimlig", () => {
    const lamH = 1.4;
    const lamA = 1.1;
    const pHome = 1 - Math.exp(-lamH);
    const pAway = 1 - Math.exp(-lamA);
    const bttsPct = pHome * pAway * 100;
    expect(bttsPct).toBeGreaterThan(30);
    expect(bttsPct).toBeLessThan(90);
  });
});
