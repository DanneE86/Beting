import { supabaseAdmin } from "@/integrations/supabase/client.server";

export type LeagueArchiveStats = {
  leagueId: string;
  matches: number;
  avgGoals: number;
  homeWinRate: number;
  drawRate: number;
  awayWinRate: number;
  bttsRate: number;
  homeGoalsPerGame: number;
  awayGoalsPerGame: number;
};

export type TeamArchiveRatings = {
  teamId: string;
  matches: number;
  attack: number;
  defense: number;
};

export type LeagueModelParams = {
  leagueId: string;
  homeAdvantage: number;
  marketBlendWeight: number;
  avgGoals: number;
  homeWinRate: number;
  drawRate: number;
  awayWinRate: number;
  bttsRate: number;
  backtestMatches: number;
  backtestHitRate: number | null;
  backtestBrier: number | null;
};

/** Ligastatistik från archived_seasons (3 års backfill). */
export async function getLeagueArchiveStats(leagueId: string): Promise<LeagueArchiveStats | null> {
  const { data, error } = await supabaseAdmin
    .from("archived_seasons")
    .select("home_score, away_score, outcome, btts")
    .eq("league_id", leagueId)
    .not("outcome", "is", null);

  if (error || !data?.length) return null;

  let h = 0,
    d = 0,
    a = 0,
    goals = 0,
    btts = 0,
    bttsN = 0,
    homeG = 0,
    awayG = 0;

  for (const r of data) {
    const hs = Number(r.home_score);
    const as = Number(r.away_score);
    if (!Number.isFinite(hs) || !Number.isFinite(as)) continue;
    goals += hs + as;
    homeG += hs;
    awayG += as;
    if (r.outcome === "1") h++;
    else if (r.outcome === "X") d++;
    else if (r.outcome === "2") a++;
    if (r.btts != null) {
      bttsN++;
      if (r.btts) btts++;
    }
  }

  const n = h + d + a;
  if (n < 30) return null;

  return {
    leagueId,
    matches: n,
    avgGoals: goals / n,
    homeWinRate: h / n,
    drawRate: d / n,
    awayWinRate: a / n,
    bttsRate: bttsN ? btts / bttsN : 0.5,
    homeGoalsPerGame: homeG / n,
    awayGoalsPerGame: awayG / n,
  };
}

/** Attack/defens per lag från arkiverade matcher (hemma+borta). */
export async function getTeamArchiveRatings(
  leagueId: string,
  homeId: string,
  awayId: string,
  leagueAvgGoals: number,
): Promise<{ home: TeamArchiveRatings | null; away: TeamArchiveRatings | null }> {
  const { data } = await supabaseAdmin
    .from("archived_seasons")
    .select("home_id, away_id, home_score, away_score")
    .eq("league_id", leagueId)
    .not("home_score", "is", null);

  if (!data?.length) return { home: null, away: null };

  const perTeam = new Map<string, { gf: number; ga: number; n: number }>();
  const bump = (id: string, gf: number, ga: number) => {
    if (!id) return;
    const cur = perTeam.get(id) ?? { gf: 0, ga: 0, n: 0 };
    cur.gf += gf;
    cur.ga += ga;
    cur.n++;
    perTeam.set(id, cur);
  };

  for (const r of data) {
    const hs = Number(r.home_score);
    const as = Number(r.away_score);
    if (!Number.isFinite(hs) || !Number.isFinite(as)) continue;
    bump(String(r.home_id), hs, as);
    bump(String(r.away_id), as, hs);
  }

  const half = leagueAvgGoals / 2;
  const toRating = (id: string): TeamArchiveRatings | null => {
    const t = perTeam.get(id);
    if (!t || t.n < 8) return null;
    return {
      teamId: id,
      matches: t.n,
      attack: t.gf / t.n,
      defense: t.ga / t.n,
    };
  };

  const home = toRating(homeId);
  const away = toRating(awayId);

  // Shrink mot ligasnitt om få matcher
  const shrink = (r: TeamArchiveRatings | null, nMin = 20) => {
    if (!r) return null;
    const w = Math.min(1, r.matches / nMin);
    return {
      ...r,
      attack: w * r.attack + (1 - w) * half,
      defense: w * r.defense + (1 - w) * half,
    };
  };

  return { home: shrink(home), away: shrink(away) };
}

export async function getLeagueModelParams(leagueId: string): Promise<LeagueModelParams | null> {
  const { data, error } = await supabaseAdmin
    .from("league_model_params")
    .select("*")
    .eq("league_id", leagueId)
    .maybeSingle();

  if (error) {
    // Tabellen kanske inte skapats än — fall back till arkivstatistik
    if (error.code === "PGRST205" || error.message.includes("league_model_params")) {
      const stats = await getLeagueArchiveStats(leagueId);
      if (!stats) return null;
      return {
        leagueId,
        homeAdvantage: 1.18,
        marketBlendWeight: 0.48,
        avgGoals: stats.avgGoals,
        homeWinRate: stats.homeWinRate,
        drawRate: stats.drawRate,
        awayWinRate: stats.awayWinRate,
        bttsRate: stats.bttsRate,
        backtestMatches: stats.matches,
        backtestHitRate: null,
        backtestBrier: null,
      };
    }
    return null;
  }

  if (data) {
    return {
      leagueId: data.league_id,
      homeAdvantage: Number(data.home_advantage),
      marketBlendWeight: Number(data.market_blend_weight),
      avgGoals: Number(data.avg_goals),
      homeWinRate: Number(data.home_win_rate ?? 0.42),
      drawRate: Number(data.draw_rate ?? 0.26),
      awayWinRate: Number(data.away_win_rate ?? 0.32),
      bttsRate: Number(data.btts_rate ?? 0.5),
      backtestMatches: data.backtest_matches ?? 0,
      backtestHitRate: data.backtest_hit_rate != null ? Number(data.backtest_hit_rate) : null,
      backtestBrier: data.backtest_brier != null ? Number(data.backtest_brier) : null,
    };
  }

  const stats = await getLeagueArchiveStats(leagueId);
  if (!stats) return null;

  return {
    leagueId,
    homeAdvantage: 1.18,
    marketBlendWeight: 0.48,
    avgGoals: stats.avgGoals,
    homeWinRate: stats.homeWinRate,
    drawRate: stats.drawRate,
    awayWinRate: stats.awayWinRate,
    bttsRate: stats.bttsRate,
    backtestMatches: stats.matches,
    backtestHitRate: null,
    backtestBrier: null,
  };
}
