import type { SupabaseClient } from "@supabase/supabase-js";
import { brierScore, tipToOutcome } from "./match-outcome";
import { pickOutcome, poissonMatchPrediction } from "./poisson-model";

export type ArchivedMatchRow = {
  league_id: string;
  home_id: string;
  away_id: string;
  home_score: number;
  away_score: number;
  outcome: string;
  btts: boolean;
  event_date: string;
};

export type LeagueModelParams = {
  league_id: string;
  home_advantage: number;
  market_blend_weight: number;
  avg_goals: number;
  home_win_rate: number;
  draw_rate: number;
  away_win_rate: number;
  btts_rate: number;
  backtest_matches: number;
  backtest_hit_rate: number;
  backtest_brier: number;
  updated_at: string;
};

function teamStats(history: ArchivedMatchRow[], teamId: string, beforeDate: Date) {
  const games = history.filter(
    (m) =>
      new Date(m.event_date) < beforeDate &&
      (m.home_id === teamId || m.away_id === teamId),
  );
  const last = games.slice(-30);
  if (last.length < 5) return null;
  let gf = 0;
  let ga = 0;
  for (const m of last) {
    if (m.home_id === teamId) {
      gf += m.home_score;
      ga += m.away_score;
    } else {
      gf += m.away_score;
      ga += m.home_score;
    }
  }
  const n = last.length;
  return { attack: gf / n, defense: ga / n, n };
}

/** Träna ligaspecifika parametrar från arkiverade matcher. */
export function trainLeagueFromRows(leagueId: string, rows: ArchivedMatchRow[]): LeagueModelParams | null {
  if (rows.length < 80) return null;

  let h = 0;
  let d = 0;
  let a = 0;
  let goals = 0;
  let btts = 0;
  for (const r of rows) {
    if (r.outcome === "1") h++;
    else if (r.outcome === "X") d++;
    else if (r.outcome === "2") a++;
    goals += r.home_score + r.away_score;
    if (r.btts) btts++;
  }
  const n = rows.length;
  const avgGoals = goals / n;
  const homeWinRate = h / n;
  const drawRate = d / n;
  const awayWinRate = a / n;
  const bttsRate = btts / n;

  const sorted = [...rows].sort(
    (x, y) => new Date(x.event_date).getTime() - new Date(y.event_date).getTime(),
  );
  const testSlice = sorted.slice(Math.floor(sorted.length * 0.25));

  let bestHa = 1.18;
  let bestBrier = Infinity;
  let bestHits = 0;

  for (let ha = 1.08; ha <= 1.28; ha += 0.02) {
    let bSum = 0;
    let hits = 0;
    let tested = 0;
    for (const m of testSlice) {
      const before = new Date(m.event_date);
      const hs = teamStats(sorted, m.home_id, before);
      const as = teamStats(sorted, m.away_id, before);
      if (!hs || !as) continue;
      const { probs } = poissonMatchPrediction({
        homeAttack: hs.attack,
        homeDefense: hs.defense,
        awayAttack: as.attack,
        awayDefense: as.defense,
        leagueAvgGoals: avgGoals,
        homeAdvantage: ha,
      });
      const pred = pickOutcome(probs.homeWinPct, probs.drawPct, probs.awayWinPct);
      const act = tipToOutcome(m.outcome);
      if (!act) continue;
      if (pred === act) hits++;
      bSum += brierScore(probs.homeWinPct, probs.drawPct, probs.awayWinPct, act);
      tested++;
    }
    if (tested < 20) continue;
    const avgB = bSum / tested;
    if (avgB < bestBrier) {
      bestBrier = avgB;
      bestHa = ha;
      bestHits = hits / tested;
    }
  }

  const marketBlend = avgGoals > 2.8 ? 0.55 : avgGoals < 2.4 ? 0.42 : 0.48;

  return {
    league_id: leagueId,
    home_advantage: Math.round(bestHa * 1000) / 1000,
    market_blend_weight: marketBlend,
    avg_goals: Math.round(avgGoals * 1000) / 1000,
    home_win_rate: Math.round(homeWinRate * 10000) / 10000,
    draw_rate: Math.round(drawRate * 10000) / 10000,
    away_win_rate: Math.round(awayWinRate * 10000) / 10000,
    btts_rate: Math.round(bttsRate * 10000) / 10000,
    backtest_matches: testSlice.length,
    backtest_hit_rate: Math.round(bestHits * 10000) / 10000,
    backtest_brier: Math.round(bestBrier * 10000) / 10000,
    updated_at: new Date().toISOString(),
  };
}

const PAGE = 1000;

/** Hämta alla arkiverade matcher för en liga (paginerat). */
export async function fetchArchivedRowsForLeague(
  supabase: SupabaseClient,
  leagueId: string,
): Promise<ArchivedMatchRow[]> {
  const rows: ArchivedMatchRow[] = [];
  let from = 0;
  while (true) {
    const { data, error } = await supabase
      .from("archived_seasons")
      .select("league_id, home_id, away_id, home_score, away_score, outcome, btts, event_date")
      .eq("league_id", leagueId)
      .not("outcome", "is", null)
      .order("event_date", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw error;
    if (!data?.length) break;
    rows.push(...(data as ArchivedMatchRow[]));
    if (data.length < PAGE) break;
    from += PAGE;
  }
  return rows;
}
