export type ScheduleMatchRow = {
  result: "W" | "D" | "L";
  score: string;
  opponent: string;
  homeAway: "home" | "away";
  usScore: number;
  themScore: number;
  date: string;
  opponentId?: string;
};

export type GoalTrendStats = {
  sample: number;
  avgGoalsFor: number;
  avgGoalsAgainst: number;
  bttsPct: number;
  over25Pct: number;
  cleanSheets: number;
  failedToScore: number;
};

/** Dixon-Coles tidsvikting: nyare matcher väger tyngre (xi ≈ 0.012/dag). */
const FORM_DECAY_XI = 0.012;

export function matchWeight(date: string | undefined): number {
  if (!date) return 1;
  const days = Math.max(0, (Date.now() - new Date(date).getTime()) / 86400000);
  return Math.exp(-FORM_DECAY_XI * days);
}

export function computeGoalStats(matches: ScheduleMatchRow[]): GoalTrendStats | null {
  if (!matches.length) return null;
  const last10 = matches.slice(-10);
  let wSum = 0;
  let goalsFor = 0;
  let goalsAg = 0;
  let btts = 0;
  let over25 = 0;
  let cleanSheets = 0;
  let failedToScore = 0;
  for (const m of last10) {
    const w = matchWeight(m.date);
    wSum += w;
    goalsFor += m.usScore * w;
    goalsAg += m.themScore * w;
    if (m.usScore > 0 && m.themScore > 0) btts += w;
    if (m.usScore + m.themScore > 2) over25 += w;
    if (m.themScore === 0) cleanSheets += w;
    if (m.usScore === 0) failedToScore += w;
  }
  const total = wSum || last10.length;
  return {
    sample: last10.length,
    avgGoalsFor: Math.round((goalsFor / total) * 100) / 100,
    avgGoalsAgainst: Math.round((goalsAg / total) * 100) / 100,
    bttsPct: Math.round((btts / total) * 100),
    over25Pct: Math.round((over25 / total) * 100),
    cleanSheets: Math.round(cleanSheets),
    failedToScore: Math.round(failedToScore),
  };
}

export function goalStatsForVenue(matches: ScheduleMatchRow[], side: "home" | "away") {
  const filtered = matches.filter((m) => m.homeAway === side).slice(-8);
  if (!filtered.length) return null;
  let wSum = 0;
  let gf = 0;
  let ga = 0;
  for (const m of filtered) {
    const w = matchWeight(m.date);
    wSum += w;
    gf += m.usScore * w;
    ga += m.themScore * w;
  }
  const t = wSum || filtered.length;
  return { avgGoalsFor: gf / t, avgGoalsAgainst: ga / t };
}

export function homeAwaySplitForm(matches: ScheduleMatchRow[], side: "home" | "away") {
  return matches
    .filter((m) => m.homeAway === side)
    .slice(-5)
    .map((m) => ({ result: m.result, score: m.score, opponent: m.opponent }));
}

export function buildH2H(homeMatches: ScheduleMatchRow[], awayId: string) {
  return homeMatches
    .filter((m) => m.opponentId === awayId)
    .slice(-5)
    .reverse()
    .map((m) => ({
      date: m.date?.slice(0, 10),
      result: m.result,
      score: m.score,
      venue: m.homeAway,
    }));
}

export function daysSinceLast(matches: ScheduleMatchRow[]): number | null {
  if (!matches.length) return null;
  const last = matches[matches.length - 1];
  if (!last?.date) return null;
  return Math.max(0, Math.round((Date.now() - new Date(last.date).getTime()) / 86400000));
}

/**
 * H2H numerisk justering — returnerar pp-justeringar (±) för 1X2 baserade
 * på inbördes historik från hemmalagets perspektiv.
 * Max ±4pp: tillräcklig signal utan att dominera, kräver ≥3 matcher.
 */
export function h2hAdjustmentPp(
  h2h: { date?: string; result: "W" | "D" | "L" }[],
  maxPp = 4,
): { homeAdj: number; drawAdj: number; awayAdj: number } {
  if (h2h.length < 3) return { homeAdj: 0, drawAdj: 0, awayAdj: 0 };
  let wSum = 0;
  let homeScore = 0;
  let drawWeight = 0;
  for (const m of h2h) {
    const w = matchWeight(m.date);
    wSum += w;
    if (m.result === "W") homeScore += w;
    else if (m.result === "L") homeScore -= w;
    else drawWeight += w; // D bidrar till draw-signal
  }
  if (wSum < 0.1) return { homeAdj: 0, drawAdj: 0, awayAdj: 0 };
  const ratio = homeScore / wSum; // -1 (away dominerar) → +1 (home dominerar)
  // Om H2H har hög andel kryss → liten drawAdj
  const drawRatio = drawWeight / wSum;
  const drawAdj = drawRatio >= 0.4 ? 2 : 0;
  const homeAdj = Math.round(ratio * maxPp);
  return {
    homeAdj,
    drawAdj,
    awayAdj: -homeAdj,
  };
}
