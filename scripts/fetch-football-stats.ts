/**
 * Hämtar lag- och spelardatan för alla ligor från ESPN summary-endpoint.
 *
 * Lagstats: bollinehav, passningar, gula/röda kort, skott, hörnor, regelbrott
 * Spelardatas per match: mål, assist, skott, räddningar, regelbrott, offside, kort
 * Spelardatas per säsong: ackumulerat från alla matcher
 *
 *   npm run stats               → alla ligor, max 50 matcher per liga (test)
 *   npm run stats -- --full    → alla ligor, alla matcher
 *   npm run stats -- --league=eng.1 --full
 *   npm run stats -- --limit=200
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { espnGet } from "../src/lib/espn.api";
import { LEAGUES } from "../src/lib/leagues";
import { createScriptSupabase, loadEnv, sleep } from "../src/lib/script-env";

const DEFAULT_LIMIT_PER_LEAGUE = 50;
const DELAY_MS = 350;

// ─── Typer ────────────────────────────────────────────────────────────────────

type TeamStatBlock = {
  possession: number | null;
  passesTotal: number | null;
  passesAccurate: number | null;
  passPct: number | null;
  yellowCards: number | null;
  redCards: number | null;
  shots: number | null;
  shotsOnTarget: number | null;
  fouls: number | null;
  corners: number | null;
};

type MatchStatsRow = {
  league_id: string;
  season: string;
  event_id: string;
  event_date: string | null;
  home_team_id: string | null;
  home_team_name: string | null;
  away_team_id: string | null;
  away_team_name: string | null;
  home_possession: number | null;
  home_passes_total: number | null;
  home_passes_accurate: number | null;
  home_pass_pct: number | null;
  home_yellow_cards: number | null;
  home_red_cards: number | null;
  home_shots: number | null;
  home_shots_on_target: number | null;
  home_fouls: number | null;
  home_corners: number | null;
  away_possession: number | null;
  away_passes_total: number | null;
  away_passes_accurate: number | null;
  away_pass_pct: number | null;
  away_yellow_cards: number | null;
  away_red_cards: number | null;
  away_shots: number | null;
  away_shots_on_target: number | null;
  away_fouls: number | null;
  away_corners: number | null;
  raw: unknown;
  fetched_at: string;
  updated_at: string;
};

type PlayerMatchStats = {
  league_id: string;
  season: string;
  event_id: string;
  event_date: string | null;
  athlete_id: string;
  athlete_name: string;
  team_id: string;
  team_name: string;
  home_away: string;
  position: string | null;
  jersey: string | null;
  formation_place: string | null;
  starter: boolean;
  subbed_in: boolean;
  subbed_out: boolean;
  goals: number;
  assists: number;
  own_goals: number;
  shots: number;
  shots_on_target: number;
  saves: number;
  shots_faced: number;
  goals_conceded: number;
  fouls_committed: number;
  fouls_suffered: number;
  yellow_cards: number;
  red_cards: number;
  offsides: number;
  fetched_at: string;
};

type PlayerSeasonAccum = {
  athlete_name: string;
  team_id: string;
  team_name: string;
  appearances: number;
  starts: number;
  sub_ins: number;
  goals: number;
  assists: number;
  own_goals: number;
  yellow_cards: number;
  red_cards: number;
  shots: number;
  shots_on_target: number;
  saves: number;
  shots_faced: number;
  goals_conceded: number;
  fouls_committed: number;
  fouls_suffered: number;
  offsides: number;
};

// ─── Hjälpfunktioner ──────────────────────────────────────────────────────────

function statVal(
  stats: Array<{ name: string; value?: number; displayValue?: string }>,
  name: string,
): number | null {
  const s = stats?.find((x) => x.name === name);
  if (!s) return null;
  const v = s.value ?? Number(s.displayValue);
  return isNaN(v) ? null : v;
}

function statNum(
  stats: Array<{ name: string; value?: number; displayValue?: string }>,
  name: string,
): number {
  return statVal(stats, name) ?? 0;
}

function parseTeamStats(
  teamBlock:
    | { statistics?: Array<{ name: string; value?: number; displayValue?: string }> }
    | undefined,
): TeamStatBlock {
  const stats = teamBlock?.statistics ?? [];
  return {
    possession: statVal(stats, "possessionPct"),
    passesTotal: statVal(stats, "totalPasses"),
    passesAccurate: statVal(stats, "accuratePasses"),
    passPct: statVal(stats, "passPct"),
    yellowCards: statVal(stats, "yellowCards"),
    redCards: statVal(stats, "redCards"),
    shots: statVal(stats, "totalShots"),
    shotsOnTarget: statVal(stats, "shotsOnTarget"),
    fouls: statVal(stats, "foulsCommitted"),
    corners: statVal(stats, "wonCorners"),
  };
}

// ─── ESPN summary parsning ─────────────────────────────────────────────────────

type SummaryResult = {
  matchRow: Omit<MatchStatsRow, "league_id" | "season"> | null;
  playerMatchStats: PlayerMatchStats[];
};

function parseSummary(
  data: Record<string, unknown>,
  eventId: string,
  eventDate: string | null,
  leagueId: string,
  season: string,
): SummaryResult {
  const playerMatchStats: PlayerMatchStats[] = [];
  const teams = (data.boxscore as any)?.teams as
    | Array<{
        team?: { id?: string; displayName?: string };
        homeAway?: string;
        statistics?: Array<{ name: string; value?: number; displayValue?: string }>;
      }>
    | undefined;

  if (!teams || teams.length < 2) return { matchRow: null, playerMatchStats };

  const homeBlock = teams.find((t) => t.homeAway === "home");
  const awayBlock = teams.find((t) => t.homeAway === "away");
  if (!homeBlock || !awayBlock) return { matchRow: null, playerMatchStats };

  const homeStats = parseTeamStats(homeBlock);
  const awayStats = parseTeamStats(awayBlock);

  const now = new Date().toISOString();
  const matchRow: Omit<MatchStatsRow, "league_id" | "season"> = {
    event_id: eventId,
    event_date: eventDate,
    home_team_id: homeBlock.team?.id ?? null,
    home_team_name: homeBlock.team?.displayName ?? null,
    away_team_id: awayBlock.team?.id ?? null,
    away_team_name: awayBlock.team?.displayName ?? null,
    home_possession: homeStats.possession,
    home_passes_total: homeStats.passesTotal,
    home_passes_accurate: homeStats.passesAccurate,
    home_pass_pct: homeStats.passPct,
    home_yellow_cards: homeStats.yellowCards,
    home_red_cards: homeStats.redCards,
    home_shots: homeStats.shots,
    home_shots_on_target: homeStats.shotsOnTarget,
    home_fouls: homeStats.fouls,
    home_corners: homeStats.corners,
    away_possession: awayStats.possession,
    away_passes_total: awayStats.passesTotal,
    away_passes_accurate: awayStats.passesAccurate,
    away_pass_pct: awayStats.passPct,
    away_yellow_cards: awayStats.yellowCards,
    away_red_cards: awayStats.redCards,
    away_shots: awayStats.shots,
    away_shots_on_target: awayStats.shotsOnTarget,
    away_fouls: awayStats.fouls,
    away_corners: awayStats.corners,
    raw: {
      boxscore_teams: teams.map((t) => ({
        team: t.team,
        homeAway: t.homeAway,
        stats: t.statistics?.map((s) => ({ name: s.name, value: s.value })),
      })),
    },
    fetched_at: now,
    updated_at: now,
  };

  // Per-match spelardatan
  const rosters = (data.rosters as any[]) ?? [];
  for (const r of rosters) {
    if (!r?.roster || !r?.team) continue;
    const teamId: string = r.team?.id ?? "";
    const teamName: string = r.team?.displayName ?? "";
    const homeAway: string = r.homeAway ?? "";

    for (const entry of r.roster as Array<{
      athlete?: { id?: string; displayName?: string };
      position?: { displayName?: string };
      jersey?: string;
      formationPlace?: string;
      starter?: boolean;
      subbedIn?: boolean;
      subbedOut?: boolean;
      stats?: Array<{ name: string; value?: number; displayValue?: string }>;
    }>) {
      const athleteId = entry.athlete?.id;
      if (!athleteId) continue;

      const stats = entry.stats ?? [];

      playerMatchStats.push({
        league_id: leagueId,
        season,
        event_id: eventId,
        event_date: eventDate,
        athlete_id: athleteId,
        athlete_name: entry.athlete?.displayName ?? "",
        team_id: teamId,
        team_name: teamName,
        home_away: homeAway,
        position: entry.position?.displayName ?? null,
        jersey: entry.jersey ?? null,
        formation_place: entry.formationPlace ?? null,
        starter: entry.starter ?? false,
        subbed_in: entry.subbedIn ?? false,
        subbed_out: entry.subbedOut ?? false,
        goals: statNum(stats, "totalGoals"),
        assists: statNum(stats, "goalAssists"),
        own_goals: statNum(stats, "ownGoals"),
        shots: statNum(stats, "totalShots"),
        shots_on_target: statNum(stats, "shotsOnTarget"),
        saves: statNum(stats, "saves"),
        shots_faced: statNum(stats, "shotsFaced"),
        goals_conceded: statNum(stats, "goalsConceded"),
        fouls_committed: statNum(stats, "foulsCommitted"),
        fouls_suffered: statNum(stats, "foulsSuffered"),
        yellow_cards: statNum(stats, "yellowCards"),
        red_cards: statNum(stats, "redCards"),
        offsides: statNum(stats, "offsides"),
        fetched_at: now,
      });
    }
  }

  return { matchRow, playerMatchStats };
}

// ─── DB-hjälpare ──────────────────────────────────────────────────────────────

async function getAlreadyFetchedEventIds(
  supabase: SupabaseClient,
  leagueId: string,
): Promise<Set<string>> {
  // Kontrollera player_match_stats - om den har data för event har vi hämtat allt
  const { data } = await supabase
    .from("football_player_match_stats")
    .select("event_id")
    .eq("league_id", leagueId);
  return new Set((data ?? []).map((r: { event_id: string }) => r.event_id));
}

async function getEventsForLeague(
  supabase: SupabaseClient,
  leagueId: string,
  limit: number,
): Promise<Array<{ event_id: string; event_date: string; season: string }>> {
  const { data, error } = await supabase
    .from("archived_seasons")
    .select("event_id, event_date, season")
    .eq("league_id", leagueId)
    .not("outcome", "is", null)
    .gte("event_date", "2025-09-01")
    .order("event_date", { ascending: false })
    .limit(limit);
  if (error) throw new Error(`[${leagueId}] archived_seasons: ${error.message}`);
  return (data ?? []) as typeof data extends null ? [] : NonNullable<typeof data>;
}

async function saveMatchStats(
  supabase: SupabaseClient,
  leagueId: string,
  season: string,
  row: Omit<MatchStatsRow, "league_id" | "season">,
): Promise<void> {
  const { error } = await supabase
    .from("football_match_stats")
    .upsert({ league_id: leagueId, season, ...row }, { onConflict: "league_id,event_id" });
  if (error) throw new Error(`save match_stats ${row.event_id}: ${error.message}`);
}

async function savePlayerMatchStats(
  supabase: SupabaseClient,
  rows: PlayerMatchStats[],
): Promise<void> {
  if (rows.length === 0) return;
  for (let i = 0; i < rows.length; i += 200) {
    const batch = rows.slice(i, i + 200);
    const { error } = await supabase
      .from("football_player_match_stats")
      .upsert(batch, { onConflict: "league_id,event_id,athlete_id" });
    if (error) throw new Error(`save player_match_stats: ${error.message}`);
  }
}

async function flushPlayerSeasonStats(
  supabase: SupabaseClient,
  leagueId: string,
  season: string,
  playerMap: Map<string, { athleteId: string } & PlayerSeasonAccum>,
): Promise<number> {
  if (playerMap.size === 0) return 0;
  const rows = [...playerMap.entries()].map(([athleteId, p]) => ({
    league_id: leagueId,
    season,
    athlete_id: athleteId,
    athlete_name: p.athlete_name,
    team_id: p.team_id,
    team_name: p.team_name,
    appearances: p.appearances,
    starts: p.starts,
    sub_ins: p.sub_ins,
    goals: p.goals,
    assists: p.assists,
    own_goals: p.own_goals,
    yellow_cards: p.yellow_cards,
    red_cards: p.red_cards,
    shots: p.shots,
    shots_on_target: p.shots_on_target,
    saves: p.saves,
    shots_faced: p.shots_faced,
    goals_conceded: p.goals_conceded,
    fouls_committed: p.fouls_committed,
    fouls_suffered: p.fouls_suffered,
    offsides: p.offsides,
    updated_at: new Date().toISOString(),
  }));

  for (let i = 0; i < rows.length; i += 200) {
    const batch = rows.slice(i, i + 200);
    const { error } = await supabase
      .from("football_player_season_stats")
      .upsert(batch, { onConflict: "league_id,season,athlete_id" });
    if (error) throw new Error(`save player_season_stats [${leagueId}/${season}]: ${error.message}`);
  }
  return rows.length;
}

// ─── Per-liga pipeline ─────────────────────────────────────────────────────────

async function processLeague(
  supabase: SupabaseClient,
  leagueId: string,
  opts: { limit: number },
): Promise<{ fetched: number; skipped: number; players: number }> {
  const events = await getEventsForLeague(supabase, leagueId, opts.limit);
  if (events.length === 0) return { fetched: 0, skipped: 0, players: 0 };

  const already = await getAlreadyFetchedEventIds(supabase, leagueId);

  // Säsongsackumulering per spelare
  const playersBySeason = new Map<string, Map<string, { athleteId: string } & PlayerSeasonAccum>>();

  // Hämta befintliga säsongsvärden
  const seasons = [...new Set(events.map((e) => e.season))];
  for (const season of seasons) {
    const { data: existing } = await supabase
      .from("football_player_season_stats")
      .select(
        "athlete_id,appearances,starts,sub_ins,goals,assists,own_goals,yellow_cards,red_cards,shots,shots_on_target,saves,shots_faced,goals_conceded,fouls_committed,fouls_suffered,offsides,athlete_name,team_id,team_name",
      )
      .eq("league_id", leagueId)
      .eq("season", season);

    const seasonMap = new Map<string, { athleteId: string } & PlayerSeasonAccum>();
    for (const p of existing ?? []) {
      seasonMap.set(p.athlete_id, {
        athleteId: p.athlete_id,
        athlete_name: p.athlete_name ?? "",
        team_id: p.team_id ?? "",
        team_name: p.team_name ?? "",
        appearances: p.appearances ?? 0,
        starts: p.starts ?? 0,
        sub_ins: p.sub_ins ?? 0,
        goals: p.goals ?? 0,
        assists: p.assists ?? 0,
        own_goals: p.own_goals ?? 0,
        yellow_cards: p.yellow_cards ?? 0,
        red_cards: p.red_cards ?? 0,
        shots: p.shots ?? 0,
        shots_on_target: p.shots_on_target ?? 0,
        saves: p.saves ?? 0,
        shots_faced: p.shots_faced ?? 0,
        goals_conceded: p.goals_conceded ?? 0,
        fouls_committed: p.fouls_committed ?? 0,
        fouls_suffered: p.fouls_suffered ?? 0,
        offsides: p.offsides ?? 0,
      });
    }
    playersBySeason.set(season, seasonMap);
  }

  let fetched = 0;
  let skipped = 0;

  for (const ev of events) {
    if (already.has(ev.event_id)) {
      skipped++;
      continue;
    }

    try {
      const url = `https://site.api.espn.com/apis/site/v2/sports/soccer/${leagueId}/summary?event=${ev.event_id}`;
      let data: Record<string, unknown> | null = null;
      for (let attempt = 1; attempt <= 3; attempt++) {
        try {
          data = await espnGet<Record<string, unknown>>(url);
          break;
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          if (msg.includes("502") && attempt < 3) {
            await sleep(attempt * 2000);
          } else {
            throw err;
          }
        }
      }
      if (!data) throw new Error("no data after retries");

      const { matchRow, playerMatchStats } = parseSummary(
        data,
        ev.event_id,
        ev.event_date,
        leagueId,
        ev.season,
      );

      if (matchRow) {
        await saveMatchStats(supabase, leagueId, ev.season, matchRow);
      }

      // Spara per-match spelardatan
      await savePlayerMatchStats(supabase, playerMatchStats);

      // Ackumulera säsongsdata
      const seasonMap = playersBySeason.get(ev.season) ?? new Map();
      for (const p of playerMatchStats) {
        const existing = seasonMap.get(p.athlete_id);
        if (existing) {
          existing.appearances += p.starter || p.subbed_in ? 1 : 0;
          if (p.starter) existing.starts += 1;
          if (p.subbed_in) existing.sub_ins += 1;
          existing.goals += p.goals;
          existing.assists += p.assists;
          existing.own_goals += p.own_goals;
          existing.yellow_cards += p.yellow_cards;
          existing.red_cards += p.red_cards;
          existing.shots += p.shots;
          existing.shots_on_target += p.shots_on_target;
          existing.saves += p.saves;
          existing.shots_faced += p.shots_faced;
          existing.goals_conceded += p.goals_conceded;
          existing.fouls_committed += p.fouls_committed;
          existing.fouls_suffered += p.fouls_suffered;
          existing.offsides += p.offsides;
        } else {
          seasonMap.set(p.athlete_id, {
            athleteId: p.athlete_id,
            athlete_name: p.athlete_name,
            team_id: p.team_id,
            team_name: p.team_name,
            appearances: p.starter || p.subbed_in ? 1 : 0,
            starts: p.starter ? 1 : 0,
            sub_ins: p.subbed_in ? 1 : 0,
            goals: p.goals,
            assists: p.assists,
            own_goals: p.own_goals,
            yellow_cards: p.yellow_cards,
            red_cards: p.red_cards,
            shots: p.shots,
            shots_on_target: p.shots_on_target,
            saves: p.saves,
            shots_faced: p.shots_faced,
            goals_conceded: p.goals_conceded,
            fouls_committed: p.fouls_committed,
            fouls_suffered: p.fouls_suffered,
            offsides: p.offsides,
          });
        }
      }
      playersBySeason.set(ev.season, seasonMap);

      fetched++;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`  [${leagueId}] ${ev.event_id}: ${msg}`);
    }

    await sleep(DELAY_MS);
  }

  // Spara säsongsdata
  let totalPlayers = 0;
  for (const [season, seasonMap] of playersBySeason) {
    if (seasonMap.size === 0) continue;
    const saved = await flushPlayerSeasonStats(supabase, leagueId, season, seasonMap);
    totalPlayers += saved;
  }

  return { fetched, skipped, players: totalPlayers };
}

// ─── CLI-argument ─────────────────────────────────────────────────────────────

function parseArgs(argv: string[]) {
  let full = false;
  let leagueFilter: string | null = null;
  let limitOverride: number | null = null;

  for (const arg of argv) {
    if (arg === "--full") full = true;
    else if (arg.startsWith("--league=")) leagueFilter = arg.slice(9);
    else if (arg.startsWith("--limit=")) limitOverride = parseInt(arg.slice(8), 10);
  }

  const limit = limitOverride ?? (full ? 9999 : DEFAULT_LIMIT_PER_LEAGUE);
  return { full, leagueFilter, limit };
}

// ─── Huvud ────────────────────────────────────────────────────────────────────

async function main(argv = process.argv.slice(2)) {
  loadEnv();
  const { limit, leagueFilter } = parseArgs(argv);
  const supabase = createScriptSupabase();

  const leagues = leagueFilter
    ? LEAGUES.filter((l) => l.id === leagueFilter)
    : [...LEAGUES];

  if (leagues.length === 0) {
    console.error(`Ingen liga hittades: ${leagueFilter}`);
    process.exit(1);
  }

  const mode = limit >= 9999 ? "FULL" : `max ${limit} per liga`;
  console.log(`\n=== Hämtar fotbollsstatistik (${mode}) ===`);
  console.log(`Ligor: ${leagues.map((l) => l.id).join(", ")}\n`);

  let grandFetched = 0;
  let grandSkipped = 0;
  let grandPlayers = 0;
  const errors: string[] = [];

  for (const league of leagues) {
    const t0 = Date.now();
    process.stdout.write(`▶ ${league.name} (${league.id})… `);
    try {
      const { fetched, skipped, players } = await processLeague(supabase, league.id, { limit });
      const sec = ((Date.now() - t0) / 1000).toFixed(1);
      console.log(`✓ ${fetched} nya, ${skipped} skip, ${players} spelare (${sec}s)`);
      grandFetched += fetched;
      grandSkipped += skipped;
      grandPlayers += players;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.log(`✗ ${msg}`);
      errors.push(`${league.id}: ${msg}`);
    }
  }

  console.log(`\n=== Klart ===`);
  console.log(`Matcher hämtade: ${grandFetched}`);
  console.log(`Matcher skip:    ${grandSkipped}`);
  console.log(`Spelarposter:    ${grandPlayers}`);
  if (errors.length) {
    console.log(`Fel (${errors.length}):`);
    errors.forEach((e) => console.log(`  ${e}`));
  }
}

const entry = process.argv[1]?.replace(/\\/g, "/") ?? "";
if (entry.endsWith("fetch-football-stats.ts")) {
  main().catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  });
}

export { main as fetchFootballStatsMain };
