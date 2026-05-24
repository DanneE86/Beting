/**
 * BTTS (Both Teams To Score) — kombinerar Poisson/Dixon-Coles, form, ligabaseline.
 */

import { poissonPmf } from "./poisson-model";
import type { GoalTrendStats } from "./form-stats";

export type VenueGoalStats = {
  avgGoalsFor: number;
  avgGoalsAgainst: number;
};

export type BttsPrediction = {
  pct: number;
  call: "ja" | "nej" | "osäker";
  reason: string;
  confidence: "låg" | "medel" | "hög";
};

/** BTTS% från Dixon-Coles-matris (summa celler där båda gör ≥1 mål). */
export function bttsProbFromMatrix(matrix: number[][]): number {
  let p = 0;
  for (let i = 0; i < matrix.length; i++) {
    for (let j = 0; j < (matrix[i]?.length ?? 0); j++) {
      if (i > 0 && j > 0) p += matrix[i][j] ?? 0;
    }
  }
  return Math.round(p * 1000) / 10;
}

/** Oberoende Poisson-fallback om matris saknas. */
export function bttsProbFromLambdas(lamH: number, lamA: number): number {
  const pHome = 1 - poissonPmf(0, lamH);
  const pAway = 1 - poissonPmf(0, lamA);
  return Math.round(pHome * pAway * 1000) / 10;
}

function scoringProbFromStats(
  attack: number,
  oppDefense: number,
  stats: GoalTrendStats | null | undefined,
  leagueHalf: number,
): number {
  const rate = Math.max(0.2, (attack + oppDefense) / 2);
  const fromRate = 1 - Math.exp(-rate);
  if (!stats || stats.sample < 3) return fromRate;

  const failRate = stats.failedToScore / stats.sample;
  const fromForm = Math.max(0.12, Math.min(0.92, 1 - failRate * 0.88));
  const w = Math.min(0.65, stats.sample / 10);
  return (1 - w) * fromRate + w * fromForm;
}

function formBttsPct(
  homeAttack: number,
  homeDefense: number,
  awayAttack: number,
  awayDefense: number,
  homeStats: GoalTrendStats | null | undefined,
  awayStats: GoalTrendStats | null | undefined,
  leagueHalf: number,
): number | null {
  const pHome = scoringProbFromStats(homeAttack, awayDefense, homeStats, leagueHalf);
  const pAway = scoringProbFromStats(awayAttack, homeDefense, awayStats, leagueHalf);
  let pct = pHome * pAway * 100;

  if (homeStats && awayStats && homeStats.sample >= 3 && awayStats.sample >= 3) {
    const recentAvg = (homeStats.bttsPct + awayStats.bttsPct) / 2;
    pct = 0.55 * pct + 0.45 * recentAvg;
  }
  return Math.round(pct * 10) / 10;
}

function pickCall(
  pct: number,
  signalSpread: number,
): { call: "ja" | "nej" | "osäker"; confidence: "låg" | "medel" | "hög" } {
  const margin = Math.abs(pct - 50);
  if (pct >= 54) {
    return {
      call: "ja",
      confidence: margin >= 12 ? "hög" : margin >= 6 ? "medel" : "låg",
    };
  }
  if (pct <= 46) {
    return {
      call: "nej",
      confidence: margin >= 12 ? "hög" : margin >= 6 ? "medel" : "låg",
    };
  }
  // Smal mittzon — poisson vs form i konflikt → osäker, annars lean
  if (signalSpread > 18) {
    return { call: "osäker", confidence: "låg" };
  }
  if (pct >= 50.5) return { call: "ja", confidence: "låg" };
  if (pct <= 49.5) return { call: "nej", confidence: "låg" };
  return { call: "osäker", confidence: "låg" };
}

export function predictBtts(input: {
  lamH: number;
  lamA: number;
  matrix: number[][];
  homeAttack: number;
  homeDefense: number;
  awayAttack: number;
  awayDefense: number;
  homeGoalStats?: GoalTrendStats | null;
  awayGoalStats?: GoalTrendStats | null;
  leagueBttsRate?: number;
  calibrationBttsPct?: number;
  homeAbsenceScore?: number;
  awayAbsenceScore?: number;
  homeName: string;
  awayName: string;
}): BttsPrediction {
  const leagueHalf = (input.lamH + input.lamA) / 4;

  const poissonPct =
    input.matrix.length > 0
      ? bttsProbFromMatrix(input.matrix)
      : bttsProbFromLambdas(input.lamH, input.lamA);

  const formPct = formBttsPct(
    input.homeAttack,
    input.homeDefense,
    input.awayAttack,
    input.awayDefense,
    input.homeGoalStats,
    input.awayGoalStats,
    leagueHalf,
  );

  const leaguePct = (input.leagueBttsRate ?? 0.52) * 100;
  const calPct =
    input.calibrationBttsPct != null && input.calibrationBttsPct > 0
      ? input.calibrationBttsPct
      : null;

  let pct = poissonPct;
  let wPoisson = 0.5;
  let wForm = formPct != null ? 0.28 : 0;
  let wLeague = 0.14;
  let wCal = calPct != null ? 0.08 : 0;

  if (formPct == null) {
    wPoisson = 0.62;
    wLeague = calPct != null ? 0.28 : 0.38;
  }

  const totalW = wPoisson + wForm + wLeague + wCal;
  pct =
    (wPoisson * poissonPct +
      wForm * (formPct ?? poissonPct) +
      wLeague * leaguePct +
      wCal * (calPct ?? leaguePct)) /
    totalW;

  // Nyckelavbräck sänker sannolikheten att båda gör mål
  const absPenalty =
    ((input.homeAbsenceScore ?? 0) + (input.awayAbsenceScore ?? 0)) * 1.2;
  pct = Math.max(8, Math.min(92, pct - absPenalty));

  pct = Math.round(pct * 10) / 10;

  const signalSpread =
    formPct != null ? Math.abs(poissonPct - formPct) : 0;
  const { call, confidence } = pickCall(pct, signalSpread);

  const parts: string[] = [
    `Poisson/DC ${poissonPct.toFixed(0)}%`,
  ];
  if (formPct != null) {
    parts.push(`form ${formPct.toFixed(0)}%`);
    if (input.homeGoalStats && input.awayGoalStats) {
      parts.push(
        `(senaste 10: ${input.homeName} ${input.homeGoalStats.bttsPct}%, ${input.awayName} ${input.awayGoalStats.bttsPct}%)`,
      );
    }
  }
  parts.push(`ligasnitt ${leaguePct.toFixed(0)}%`);
  if (absPenalty > 0) parts.push(`avbräck −${absPenalty.toFixed(0)}%`);

  const callSv = call === "ja" ? "Ja" : call === "nej" ? "Nej" : "Osäker";
  const reason = `BTTS ${callSv} (båda gör mål ${pct.toFixed(0)}%, ${confidence} säkerhet): ${parts.join(" · ")}.`;

  return { pct, call, reason, confidence };
}
