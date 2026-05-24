/**
 * Poisson + Dixon-Coles-modell för 1X2-prognoser.
 * Dixon-Coles korrigerar vanlig Poissons systematiska underskattning av
 * låga mål (0-0, 1-1) och därmed kryss — se Dixon & Coles (1997).
 */

export type Outcome = "H" | "D" | "A";

export type MatchProbs = {
  homeWinPct: number;
  drawPct: number;
  awayWinPct: number;
};

function factorial(n: number): number {
  if (n <= 1) return 1;
  let r = 1;
  for (let i = 2; i <= n; i++) r *= i;
  return r;
}

export function poissonPmf(k: number, lambda: number): number {
  if (lambda <= 0) return k === 0 ? 1 : 0;
  if (k < 0) return 0;
  return (Math.exp(-lambda) * lambda ** k) / factorial(k);
}

/** Dixon-Coles tau-korrigering för låga mål (i,j ∈ {0,1}). */
export function dcTau(i: number, j: number, lamH: number, lamA: number, rho: number): number {
  if (i === 0 && j === 0) return 1 - lamH * lamA * rho;
  if (i === 0 && j === 1) return 1 + lamA * rho;
  if (i === 1 && j === 0) return 1 + lamH * rho;
  if (i === 1 && j === 1) return 1 - rho;
  return 1;
}

/** Heuristisk rho baserad på ligans målsnitt (Football Hacking / praktisk standard). */
export function rhoFromAvgGoals(avgGoals: number): number {
  if (avgGoals >= 3.0) return -0.02;
  if (avgGoals <= 2.6) return -0.1;
  return -0.05;
}

export function buildScoreMatrix(lamH: number, lamA: number, rho: number, maxGoals = 8): number[][] {
  const P: number[][] = [];
  for (let i = 0; i <= maxGoals; i++) {
    P[i] = [];
    for (let j = 0; j <= maxGoals; j++) {
      let p = poissonPmf(i, lamH) * poissonPmf(j, lamA);
      if (i <= 1 && j <= 1) p *= dcTau(i, j, lamH, lamA, rho);
      P[i][j] = p;
    }
  }
  const sum = P.flat().reduce((s, v) => s + v, 0);
  if (sum <= 0) return P;
  for (let i = 0; i <= maxGoals; i++) {
    for (let j = 0; j <= maxGoals; j++) P[i][j] /= sum;
  }
  return P;
}

export function probsFromMatrix(P: number[][]): MatchProbs {
  let home = 0;
  let draw = 0;
  let away = 0;
  for (let i = 0; i < P.length; i++) {
    for (let j = 0; j < P[i].length; j++) {
      if (i > j) home += P[i][j];
      else if (i === j) draw += P[i][j];
      else away += P[i][j];
    }
  }
  return normalizeProbs(home * 100, draw * 100, away * 100);
}

export function pickOutcome(h: number, d: number, a: number): Outcome {
  if (h >= d && h >= a) return "H";
  if (a >= d && a >= h) return "A";
  return "D";
}

export function normalizeProbs(h: number, d: number, a: number): MatchProbs {
  let home = Math.max(5, h);
  let draw = Math.max(18, d); // fotboll: kryss sällan under ~18% utan stark motivering
  let away = Math.max(5, a);
  const sum = home + draw + away;
  home = Math.round((home / sum) * 1000) / 10;
  draw = Math.round((draw / sum) * 1000) / 10;
  away = Math.round((1000 - home * 10 - draw * 10) / 10);
  return { homeWinPct: home, drawPct: draw, awayWinPct: away };
}

export function mostLikelyScore(
  P: number[][],
  outcome?: Outcome,
): string {
  let bestI = 0;
  let bestJ = 0;
  let bestP = -1;
  for (let i = 0; i < P.length; i++) {
    for (let j = 0; j < P[i].length; j++) {
      const cellOutcome: Outcome = i > j ? "H" : i < j ? "A" : "D";
      if (outcome && cellOutcome !== outcome) continue;
      if (P[i][j] > bestP) {
        bestP = P[i][j];
        bestI = i;
        bestJ = j;
      }
    }
  }
  if (bestP < 0 && outcome) {
    const total = 2.4;
    if (outcome === "D") return "1-1";
    if (outcome === "H") return "2-1";
    return "1-2";
  }
  return `${bestI}-${bestJ}`;
}

export function deriveConfidence(h: number, d: number, a: number): "låg" | "medel" | "hög" {
  const pcts = [h, d, a].sort((x, y) => y - x);
  const top = pcts[0];
  const margin = pcts[0] - pcts[1];
  // Kalibrerade trösklar: LLM/modeller är överkonfidenta — kräv tydlig marginal.
  if (top >= 58 && margin >= 12) return "hög";
  if (top >= 48 && margin >= 9) return "medel";
  if (top >= 42 && margin >= 6) return "medel";
  return "låg";
}

export function scoreFromOutcome(outcome: Outcome, avgTotal = 2.4): string {
  const total = Math.max(0, Math.round(avgTotal));
  if (outcome === "D") {
    const each = Math.max(0, Math.floor(total / 2));
    return `${each}-${each}`;
  }
  if (outcome === "H") {
    const lo = Math.max(0, Math.floor(total / 2));
    return `${lo + 1}-${lo}`;
  }
  const lo = Math.max(0, Math.floor(total / 2));
  return `${lo}-${lo + 1}`;
}

export function fixScoreCoherence(
  predictedScore: string,
  homeWinPct: number,
  drawPct: number,
  awayWinPct: number,
): string {
  const picked = pickOutcome(homeWinPct, drawPct, awayWinPct);
  const scoreMatch = predictedScore?.match(/(\d+)\s*[-–:]\s*(\d+)/);
  if (!scoreMatch) return predictedScore;
  const h = Number(scoreMatch[1]);
  const a = Number(scoreMatch[2]);
  const scoreOutcome: Outcome = h > a ? "H" : h < a ? "A" : "D";
  if (scoreOutcome === picked) return predictedScore;
  const total = h + a;
  if (picked === "D") {
    const each = Math.max(0, Math.round(total / 2));
    return `${each}-${each}`;
  }
  if (picked === "H") {
    const lo = Math.min(h, a);
    const hi = Math.max(h, a);
    return `${Math.max(hi, lo + 1)}-${lo}`;
  }
  const lo = Math.min(h, a);
  const hi = Math.max(h, a);
  return `${lo}-${Math.max(hi, lo + 1)}`;
}

/** Blanda modell och marknad (Egidi et al. 2018 — konvex kombination). */
export function blendWithMarket(
  model: MatchProbs,
  market: { home: number; draw: number; away: number },
  modelWeight: number,
): MatchProbs {
  const w = Math.max(0, Math.min(1, modelWeight));
  const h = w * model.homeWinPct + (1 - w) * market.home;
  const d = w * model.drawPct + (1 - w) * market.draw;
  const a = w * model.awayWinPct + (1 - w) * market.away;
  return normalizeProbs(h, d, a);
}

/** Shrink extrema sannolikheter mot ligabaseline (temperature-liknande kalibrering). */
export function shrinkTowardBaseline(
  probs: MatchProbs,
  baseline: { homePct: number; drawPct: number; awayPct: number },
  strength = 0.15,
): MatchProbs {
  const s = Math.max(0, Math.min(0.5, strength));
  const h = (1 - s) * probs.homeWinPct + s * baseline.homePct * 100;
  const d = (1 - s) * probs.drawPct + s * baseline.drawPct * 100;
  const a = (1 - s) * probs.awayWinPct + s * baseline.awayPct * 100;
  return normalizeProbs(h, d, a);
}

export type CalibrationAdjustments = {
  historicalBaseline?: { homePct: number; drawPct: number; awayPct: number; matches: number } | null;
  predictedBias?: { H: number; D: number; A: number };
  actualDistribution?: { H: number; D: number; A: number };
  resolved?: number;
  avgBrier?: number | null;
  byConfidence?: Record<string, { n: number; hits: number }>;
};

/**
 * Post-hoc kalibrering baserad på historisk prestanda.
 * Forskning: kalibrering slår ren träffsäkerhet för betting (SciDirect 2024).
 */
export function applyCalibrationAdjustments(
  probs: MatchProbs,
  cal?: CalibrationAdjustments | null,
): MatchProbs {
  let { homeWinPct, drawPct, awayWinPct } = probs;

  // Hårt tak: sällan >65% i typisk ligamatch (undviker överkonfidens).
  const cap = (v: number, max: number) => Math.min(max, v);
  homeWinPct = cap(homeWinPct, 65);
  awayWinPct = cap(awayWinPct, 65);
  drawPct = cap(drawPct, 40);

  if (cal?.historicalBaseline && cal.historicalBaseline.matches >= 20) {
    ({ homeWinPct, drawPct, awayWinPct } = shrinkTowardBaseline(
      { homeWinPct, drawPct, awayWinPct },
      cal.historicalBaseline,
      0.12,
    ));
  }

  if (cal && (cal.resolved ?? 0) >= 15 && cal.predictedBias && cal.actualDistribution) {
    const pred = cal.predictedBias;
    const actual = cal.actualDistribution;
    const homeBias = pred.H - actual.H;
    if (homeBias > 0.12) homeWinPct = Math.max(5, homeWinPct - 4);
    if (homeBias < -0.08) homeWinPct = Math.min(65, homeWinPct + 2);
    if (pred.D < actual.D - 0.05) drawPct = Math.min(38, drawPct + 4);
    // Bortafavoriter har historiskt överpresterats i modellen — dra ned.
    if (awayWinPct >= 55 && awayWinPct === Math.max(homeWinPct, drawPct, awayWinPct)) {
      awayWinPct = Math.max(5, awayWinPct - 5);
      drawPct = Math.min(38, drawPct + 3);
    }
  }

  // Hög Brier (>0.55) = dålig kalibrering → extra shrink mot jämn fördelning.
  if (cal?.avgBrier != null && cal.avgBrier > 0.55) {
    ({ homeWinPct, drawPct, awayWinPct } = shrinkTowardBaseline(
      { homeWinPct, drawPct, awayWinPct },
      { homePct: 0.42, drawPct: 0.26, awayPct: 0.32 },
      0.1,
    ));
  }

  return normalizeProbs(homeWinPct, drawPct, awayWinPct);
}

export function poissonMatchPrediction(input: {
  homeAttack: number;
  homeDefense: number;
  awayAttack: number;
  awayDefense: number;
  leagueAvgGoals?: number;
  homeAdvantage?: number;
}): { probs: MatchProbs; predictedScore: string; matrix: number[][]; lamH: number; lamA: number } {
  const leagueAvg = input.leagueAvgGoals ?? 2.65;
  const homeAdv = input.homeAdvantage ?? 1.18;

  const lamH = Math.max(0.3, Math.min(3.5, ((input.homeAttack + input.awayDefense) / 2) * homeAdv));
  const lamA = Math.max(0.3, Math.min(3.5, (input.awayAttack + input.homeDefense) / 2));

  const avgTotal = lamH + lamA;
  const rho = rhoFromAvgGoals(leagueAvg);
  const maxGoals = avgTotal > 3.2 ? 10 : avgTotal > 2.5 ? 8 : 7;
  const matrix = buildScoreMatrix(lamH, lamA, rho, maxGoals);
  const probs = probsFromMatrix(matrix);
  const outcome = pickOutcome(probs.homeWinPct, probs.drawPct, probs.awayWinPct);
  const predictedScore = mostLikelyScore(matrix, outcome) || scoreFromOutcome(outcome, avgTotal);

  return { probs, predictedScore, matrix, lamH, lamA };
}
