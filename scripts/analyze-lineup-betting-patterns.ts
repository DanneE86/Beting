/**
 * Analyserar spelare och startelvor mot matchresultat för att hitta betting-mönster.
 *
 * Kör: npx tsx scripts/analyze-lineup-betting-patterns.ts
 */

import { loadEnv } from "../src/lib/script-env";
loadEnv();
import { createClient } from "@supabase/supabase-js";

const sb = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// ─── Hjälpfunktioner ─────────────────────────────────────────────────────────

function pct(n: number, d: number) {
  if (d === 0) return "–";
  return ((n / d) * 100).toFixed(1) + "%";
}

function avg(arr: number[]) {
  if (!arr.length) return 0;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

// ─── Steg 1: Hämta vilka ligor + säsonger vi har data för ──────────────────────

async function getAvailableLeagues() {
  const { data } = await sb
    .from("football_player_match_stats")
    .select("league_id, season")
    .order("league_id");

  const seen = new Set<string>();
  const leagues: { league_id: string; season: string }[] = [];
  for (const r of data ?? []) {
    const key = `${r.league_id}::${r.season}`;
    if (!seen.has(key)) {
      seen.add(key);
      leagues.push(r);
    }
  }
  return leagues;
}

// ─── Steg 2: Hämta matcher med resultat från football_match_intel ─────────────

async function getRecentMatches(leagueId: string, season: string, limit = 10) {
  const { data } = await sb
    .from("football_match_intel")
    .select(
      "event_id, event_date, home_name, away_name, home_score, away_score, home_team_id, away_team_id"
    )
    .eq("league_id", leagueId)
    .eq("season", season)
    .not("home_score", "is", null)
    .order("event_date", { ascending: false })
    .limit(limit);
  return data ?? [];
}

// ─── Steg 3: Hämta spelardata per match ──────────────────────────────────────

async function getPlayerMatchStats(leagueId: string, eventIds: string[]) {
  if (!eventIds.length) return [];
  const { data } = await sb
    .from("football_player_match_stats")
    .select(
      "event_id, athlete_id, athlete_name, team_id, team_name, position, starter, goals, assists, shots, shots_on_target, yellow_cards, red_cards, saves"
    )
    .eq("league_id", leagueId)
    .in("event_id", eventIds);
  return data ?? [];
}

// ─── Steg 4: Hämta säsongstats (viktiga spelare) ─────────────────────────────

async function getTopPlayersBySeason(leagueId: string, season: string, limit = 50) {
  const { data } = await sb
    .from("football_player_season_stats")
    .select(
      "athlete_id, athlete_name, team_id, team_name, appearances, starts, goals, assists, importance_score"
    )
    .eq("league_id", leagueId)
    .eq("season", season)
    .gte("starts", 3)
    .order("importance_score", { ascending: false })
    .limit(limit);
  return data ?? [];
}

// ─── Steg 5: Hämta lineup-data ───────────────────────────────────────────────

async function getLineups(leagueId: string, eventIds: string[]) {
  if (!eventIds.length) return [];
  const { data } = await sb
    .from("football_match_lineups")
    .select("event_id, home_team_id, away_team_id, home_starters, away_starters")
    .eq("league_id", leagueId)
    .in("event_id", eventIds);
  return data ?? [];
}

// ─── Analyslogik ─────────────────────────────────────────────────────────────

type MatchRow = {
  event_id: string;
  event_date: string;
  home_name: string;
  away_name: string;
  home_score: number;
  away_score: number;
  home_team_id: string;
  away_team_id: string;
};

type PlayerStat = {
  event_id: string;
  athlete_id: string;
  athlete_name: string;
  team_id: string;
  team_name: string;
  position: string;
  starter: boolean;
  goals: number;
  assists: number;
  shots: number;
  shots_on_target: number;
  yellow_cards: number;
  red_cards: number;
  saves: number;
};

type SeasonStat = {
  athlete_id: string;
  athlete_name: string;
  team_id: string;
  team_name: string;
  appearances: number;
  starts: number;
  goals: number;
  assists: number;
  importance_score: number;
};

type LineupRow = {
  event_id: string;
  home_team_id: string;
  away_team_id: string;
  home_starters: Array<{ id: string; name: string; position?: string }>;
  away_starters: Array<{ id: string; name: string; position?: string }>;
};

type PatternResult = {
  playerName: string;
  teamName: string;
  leagueId: string;
  position: string;
  importanceScore: number;
  withPlayerStats: {
    matches: number;
    teamGoals: number[];
    teamConceded: number[];
    wins: number;
    draws: number;
    losses: number;
    btts: number;
    over25: number;
  };
  withoutPlayerStats: {
    matches: number;
    teamGoals: number[];
    teamConceded: number[];
    wins: number;
    draws: number;
    losses: number;
    btts: number;
    over25: number;
  };
};

function analyzeLeague(
  leagueId: string,
  matches: MatchRow[],
  playerStats: PlayerStat[],
  seasonStats: SeasonStat[],
  lineups: LineupRow[]
): PatternResult[] {
  // Bygg upp lookup: event_id -> match
  const matchByEvent = new Map<string, MatchRow>();
  for (const m of matches) matchByEvent.set(m.event_id, m);

  // Bygg lookup: event_id -> { teamId -> starters[] }
  const lineupByEvent = new Map<string, Map<string, Set<string>>>();
  for (const l of lineups) {
    const teamMap = new Map<string, Set<string>>();
    const homeIds = new Set((l.home_starters ?? []).map((s) => s.id));
    const awayIds = new Set((l.away_starters ?? []).map((s) => s.id));
    teamMap.set(l.home_team_id, homeIds);
    teamMap.set(l.away_team_id, awayIds);
    lineupByEvent.set(l.event_id, teamMap);
  }

  // För varje viktig spelare: kolla matcher med/utan
  const results: PatternResult[] = [];

  for (const sp of seasonStats) {
    const empty = () => ({
      matches: 0,
      teamGoals: [] as number[],
      teamConceded: [] as number[],
      wins: 0,
      draws: 0,
      losses: 0,
      btts: 0,
      over25: 0,
    });

    const withPlayer = empty();
    const withoutPlayer = empty();

    for (const match of matches) {
      const isHome = match.home_team_id === sp.team_id;
      const isAway = match.away_team_id === sp.team_id;
      if (!isHome && !isAway) continue;

      const teamGoals = isHome ? match.home_score : match.away_score;
      const oppGoals = isHome ? match.away_score : match.home_score;
      const btts = teamGoals > 0 && oppGoals > 0 ? 1 : 0;
      const over25 = teamGoals + oppGoals > 2 ? 1 : 0;
      const result = teamGoals > oppGoals ? "W" : teamGoals < oppGoals ? "L" : "D";

      // Kolla om spelaren startade – antingen via lineups-tabell eller player_match_stats
      let didStart: boolean | null = null;

      const lineupTeamMap = lineupByEvent.get(match.event_id);
      if (lineupTeamMap) {
        const starters = lineupTeamMap.get(sp.team_id);
        if (starters) {
          didStart = starters.has(sp.athlete_id);
        }
      }

      // Fallback: kolla player_match_stats
      if (didStart === null) {
        const matchPlayerStat = playerStats.find(
          (p) => p.event_id === match.event_id && p.athlete_id === sp.athlete_id
        );
        if (matchPlayerStat) {
          didStart = matchPlayerStat.starter;
        }
      }

      if (didStart === null) continue; // Ingen data om spelaren startade eller inte

      const target = didStart ? withPlayer : withoutPlayer;
      target.matches++;
      target.teamGoals.push(teamGoals);
      target.teamConceded.push(oppGoals);
      target.btts += btts;
      target.over25 += over25;
      if (result === "W") target.wins++;
      else if (result === "D") target.draws++;
      else target.losses++;
    }

    // Bara ta med spelare där vi har data i båda scenarierna (min 2 matcher var)
    if (withPlayer.matches >= 2 && withoutPlayer.matches >= 2) {
      results.push({
        playerName: sp.athlete_name,
        teamName: sp.team_name,
        leagueId,
        position: "?",
        importanceScore: sp.importance_score ?? 0,
        withPlayerStats: withPlayer,
        withoutPlayerStats: withoutPlayer,
      });
    }
  }

  return results;
}

// ─── Presentera mönster ──────────────────────────────────────────────────────

function printPatterns(patterns: PatternResult[]) {
  // Sortera efter störst skillnad i mål-snitt
  const withDiff = patterns.map((p) => {
    const avgWithGoals = avg(p.withPlayerStats.teamGoals);
    const avgWithoutGoals = avg(p.withoutPlayerStats.teamGoals);
    const winRateWith = p.withPlayerStats.wins / p.withPlayerStats.matches;
    const winRateWithout = p.withoutPlayerStats.wins / p.withoutPlayerStats.matches;
    return {
      ...p,
      avgWithGoals,
      avgWithoutGoals,
      goalDiff: avgWithGoals - avgWithoutGoals,
      winRateDiff: winRateWith - winRateWithout,
    };
  });

  // Spelare som gör STOR skillnad (goals)
  const highImpact = withDiff
    .filter((p) => Math.abs(p.goalDiff) >= 0.4 || Math.abs(p.winRateDiff) >= 0.2)
    .sort((a, b) => Math.abs(b.goalDiff) - Math.abs(a.goalDiff));

  console.log("\n═══════════════════════════════════════════════════════");
  console.log(" SPELARE MED STÖRST BETTING-PÅVERKAN (senaste 10 matcher)");
  console.log("═══════════════════════════════════════════════════════\n");

  if (!highImpact.length) {
    console.log("Ingen tydlig spelarpåverkan hittad med tillgänglig data.\n");
    return;
  }

  for (const p of highImpact.slice(0, 25)) {
    const wp = p.withPlayerStats;
    const np = p.withoutPlayerStats;
    const avgGoalsWith = avg(wp.teamGoals).toFixed(2);
    const avgGoalsWithout = avg(np.teamGoals).toFixed(2);
    const avgConcWith = avg(wp.teamConceded).toFixed(2);
    const avgConcWithout = avg(np.teamConceded).toFixed(2);
    const sign = p.goalDiff > 0 ? "↑" : "↓";

    console.log(`── ${p.playerName} (${p.teamName} | ${p.leagueId}) ──`);
    console.log(
      `   MED:  ${wp.matches}m | Mål: ${avgGoalsWith} snitt | Konc: ${avgConcWith} | ` +
        `W/D/L: ${wp.wins}/${wp.draws}/${wp.losses} | ` +
        `BTTS: ${pct(wp.btts, wp.matches)} | Ö2.5: ${pct(wp.over25, wp.matches)}`
    );
    console.log(
      `   UTAN: ${np.matches}m | Mål: ${avgGoalsWithout} snitt | Konc: ${avgConcWithout} | ` +
        `W/D/L: ${np.wins}/${np.draws}/${np.losses} | ` +
        `BTTS: ${pct(np.btts, np.matches)} | Ö2.5: ${pct(np.over25, np.matches)}`
    );
    console.log(
      `   ${sign} Mål-diff: ${p.goalDiff.toFixed(2)} | Vinst-diff: ${(p.winRateDiff * 100).toFixed(1)}pp | Importance: ${p.importanceScore?.toFixed(1) ?? "?"}`
    );
    console.log();
  }
}

// ─── Aggregat: Vilka mönster ska vi lära oss? ────────────────────────────────

function printBettingLessons(allPatterns: PatternResult[]) {
  console.log("\n═══════════════════════════════════════════════════════");
  console.log(" LÄRDOMAR FÖR BETTING-MODELLEN");
  console.log("═══════════════════════════════════════════════════════\n");

  const withDiff = allPatterns.map((p) => ({
    ...p,
    avgGoalsWith: avg(p.withPlayerStats.teamGoals),
    avgGoalsWithout: avg(p.withoutPlayerStats.teamGoals),
    goalDiff: avg(p.withPlayerStats.teamGoals) - avg(p.withoutPlayerStats.teamGoals),
    bttsWithPct: p.withPlayerStats.btts / Math.max(p.withPlayerStats.matches, 1),
    bttsWithoutPct: p.withoutPlayerStats.btts / Math.max(p.withoutPlayerStats.matches, 1),
    over25WithPct: p.withPlayerStats.over25 / Math.max(p.withPlayerStats.matches, 1),
    over25WithoutPct: p.withoutPlayerStats.over25 / Math.max(p.withoutPlayerStats.matches, 1),
    winRateWith: p.withPlayerStats.wins / Math.max(p.withPlayerStats.matches, 1),
    winRateWithout: p.withoutPlayerStats.wins / Math.max(p.withoutPlayerStats.matches, 1),
  }));

  // 1. Genomsnittlig goal-drop utan viktig spelare
  const highImportancePlayers = withDiff.filter((p) => p.importanceScore > 10);
  if (highImportancePlayers.length > 0) {
    const avgGoalDrop =
      highImportancePlayers.reduce((s, p) => s + p.goalDiff, 0) / highImportancePlayers.length;
    const avgBttsDrop =
      highImportancePlayers.reduce((s, p) => s + (p.bttsWithPct - p.bttsWithoutPct), 0) /
      highImportancePlayers.length;
    const avgOver25Drop =
      highImportancePlayers.reduce((s, p) => s + (p.over25WithPct - p.over25WithoutPct), 0) /
      highImportancePlayers.length;

    console.log(`Top-spelare (importance > 10, n=${highImportancePlayers.length}):`);
    console.log(
      `  Genomsnittlig mål-drop utan dem: ${avgGoalDrop.toFixed(2)} mål/match`
    );
    console.log(
      `  BTTS-förändring: ${(avgBttsDrop * 100).toFixed(1)}pp (negativt = sämre BTTS utan spelaren)`
    );
    console.log(
      `  Ö2.5-förändring: ${(avgOver25Drop * 100).toFixed(1)}pp`
    );
    console.log();
  }

  // 2. Ligor med starkast spelarberoende
  const byLeague = new Map<string, typeof withDiff>();
  for (const p of withDiff) {
    if (!byLeague.has(p.leagueId)) byLeague.set(p.leagueId, []);
    byLeague.get(p.leagueId)!.push(p);
  }

  console.log("Spelarberoende per liga:");
  const leagueSummaries: Array<{ league: string; avgGoalDiff: number; n: number }> = [];
  for (const [league, players] of byLeague) {
    const impPlayers = players.filter((p) => Math.abs(p.goalDiff) >= 0.3);
    if (impPlayers.length === 0) continue;
    const avgGD = impPlayers.reduce((s, p) => s + p.goalDiff, 0) / impPlayers.length;
    leagueSummaries.push({ league, avgGoalDiff: avgGD, n: impPlayers.length });
  }
  leagueSummaries.sort((a, b) => Math.abs(b.avgGoalDiff) - Math.abs(a.avgGoalDiff));
  for (const ls of leagueSummaries) {
    console.log(
      `  ${ls.league}: ${ls.n} nyckelspelare | snitt goal-diff ${ls.avgGoalDiff.toFixed(2)}`
    );
  }

  // 3. Recommendations
  console.log("\n--- Praktiska rekommendationer ---\n");
  const strongImpact = withDiff.filter((p) => p.goalDiff >= 0.5 || p.winRateWith - p.winRateWithout >= 0.3);
  if (strongImpact.length > 0) {
    console.log(`${strongImpact.length} spelare har starka positiva samband med lagets resultat.`);
    console.log(
      `När dessa är FRÅNVARANDE i startelvan: sänk angreppsrating ~${avg(strongImpact.map((p) => p.goalDiff)).toFixed(2)} mål och ` +
        `justera BTTS ned ~${(avg(strongImpact.map((p) => p.bttsWithPct - p.bttsWithoutPct)) * 100).toFixed(1)}pp`
    );
  }

  const cleanSheetImpact = withDiff.filter((p) => {
    const concDiff =
      avg(p.withPlayerStats.teamConceded) - avg(p.withoutPlayerStats.teamConceded);
    return concDiff <= -0.4; // Laget släpper färre mål när spelaren är med
  });
  if (cleanSheetImpact.length > 0) {
    console.log(
      `\n${cleanSheetImpact.length} spelare korrelerar med fler insläppta mål när de är borta (defensivt viktiga).`
    );
    console.log("Exempel: " + cleanSheetImpact.slice(0, 3).map((p) => p.playerName).join(", "));
  }
}

// ─── Huvud ────────────────────────────────────────────────────────────────────

async function main() {
  console.log("Hämtar tillgängliga ligor...");
  const leagues = await getAvailableLeagues();

  if (!leagues.length) {
    console.log(
      "Inga ligor hittade i football_player_match_stats.\n" +
        "Kör fetch-football-stats.ts och fetch-lineups.ts för att populera databasen."
    );
    return;
  }

  console.log(`Ligor med spelardata: ${leagues.map((l) => l.league_id).join(", ")}\n`);

  const allPatterns: PatternResult[] = [];

  for (const { league_id, season } of leagues) {
    console.log(`\nAnalyserar ${league_id} (${season})...`);

    const matches = (await getRecentMatches(league_id, season, 15)) as MatchRow[];
    if (matches.length === 0) {
      console.log("  Inga avslutade matcher hittade i football_match_intel.");
      continue;
    }

    console.log(`  ${matches.length} matcher hittade`);

    const eventIds = matches.map((m) => m.event_id);
    const [playerStats, seasonStats, lineups] = await Promise.all([
      getPlayerMatchStats(league_id, eventIds) as Promise<PlayerStat[]>,
      getTopPlayersBySeason(league_id, season, 60) as Promise<SeasonStat[]>,
      getLineups(league_id, eventIds) as Promise<LineupRow[]>,
    ]);

    console.log(
      `  ${playerStats.length} spelarstatsposter | ${seasonStats.length} säsongsspelare | ${lineups.length} startelvor`
    );

    const patterns = analyzeLeague(league_id, matches, playerStats, seasonStats, lineups);
    console.log(`  ${patterns.length} spelare med jämförbara med/utan-data`);
    allPatterns.push(...patterns);
  }

  // Skriv ut per spelare
  printPatterns(allPatterns);

  // Skriv ut sammanfattade lärdomar
  printBettingLessons(allPatterns);

  // ─── Rådata: Ligornas senaste matcher ──────────────────────────────────────
  console.log("\n═══════════════════════════════════════════════════════");
  console.log(" SENASTE MATCHERNA PER LIGA (raw)");
  console.log("═══════════════════════════════════════════════════════\n");

  for (const { league_id, season } of leagues) {
    const matches = (await getRecentMatches(league_id, season, 10)) as MatchRow[];
    if (!matches.length) continue;
    console.log(`\n${league_id} (${season}):`);
    for (const m of matches) {
      const date = m.event_date?.slice(0, 10) ?? "?";
      const total = m.home_score + m.away_score;
      const btts = m.home_score > 0 && m.away_score > 0 ? "BTTS" : "ej BTTS";
      const ov = total > 2 ? "Ö2.5" : "U2.5";
      console.log(
        `  ${date} | ${m.home_name} ${m.home_score}–${m.away_score} ${m.away_name} | ${btts} | ${ov}`
      );
    }
  }
}

main().catch(console.error);
