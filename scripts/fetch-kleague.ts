/**
 * Hämtar K-League 1 (Sydkorea) data från 365scores.
 *
 * Datakälla: webws.365scores.com (ingen nyckel behövs)
 * K-League 1 competition ID: 618
 * Säsongen: mars–november (kalenderår)
 *
 * Populerar:
 *   - football_match_stats       (lagstats per match)
 *   - football_player_match_stats (spelardatas per match)
 *   - football_player_season_stats (ackumulerat per säsong)
 *
 *   npx tsx scripts/fetch-kleague.ts
 *   npx tsx scripts/fetch-kleague.ts --season=2025
 */

import { createScriptSupabase, loadEnv, sleep } from "../src/lib/script-env";
import type { SupabaseClient } from "@supabase/supabase-js";

loadEnv();

const sb = createScriptSupabase();

const LEAGUE_ID = "kor.1";
const COMP_ID_365 = 618;           // 365scores competition ID för K-League 1
const DELAY_MS = 400;              // Snäll mot 365scores
const BASE_URL = "https://webws.365scores.com/web";

const HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
  Accept: "application/json",
  "Accept-Language": "en-US,en;q=0.9",
  Referer: "https://www.365scores.com/",
};

// ─── Stats-type mappning (365scores type id → fältnamn) ──────────────────────
const STAT_MAP: Record<number, string> = {
  27: "goals",
  26: "assists",
  23: "saves",
  35: "goals_conceded",
  3:  "shots",
  4:  "shots_on_target",
  42: "fouls_committed",
  37: "fouls_suffered",
  9:  "offsides",
  34: "yellow_cards",
  // red cards hämtas från events istället (type 3 = red card)
};

// ─── Typer ────────────────────────────────────────────────────────────────────

type Game365 = {
  id: number;
  competitionId: number;
  seasonNum: number;
  roundNum: number;
  startTime: string;
  statusGroup: number;
  homeCompetitor: { id: number; name: string; score?: number };
  awayCompetitor: { id: number; name: string; score?: number };
};

type GameDetail365 = {
  id: number;
  startTime: string;
  homeCompetitor: {
    id: number;
    name: string;
    score: number;
    lineups?: {
      status: string;
      formation: string;
      members: Array<{
        status: number;       // 1=Starting, 2=Substitute, 3=Not in squad
        statusText: string;
        position?: { name: string };
        stats?: Array<{ type: number; value: string | number }>;
        // member ref (linked via game.members)
      }> & Array<{ athleteId?: number; id?: number; name?: string }>;
    };
  };
  awayCompetitor: {
    id: number;
    name: string;
    score: number;
    lineups?: GameDetail365["homeCompetitor"]["lineups"];
  };
  members: Array<{
    id: number;
    athleteId?: number;
    name: string;
    shortName?: string;
    jerseyNumber?: number;
    competitorId: number;
  }>;
  events: Array<{
    eventType: { id: number; name: string };
    competitorId: number;
    playerId?: number;
    extraPlayers?: number[];
    gameTime?: number;
  }>;
};

// ─── Fetch-hjälp ─────────────────────────────────────────────────────────────

async function fetch365(path: string): Promise<unknown> {
  const r = await fetch(`${BASE_URL}${path}`, {
    headers: HEADERS,
    signal: AbortSignal.timeout(12_000),
  });
  if (!r.ok) throw new Error(`HTTP ${r.status} for ${path}`);
  return r.json();
}

// ─── Hämta alla K-League-matcher för ett datumfönster ────────────────────────

async function fetchGamesForWindow(
  fromDate: string, // dd/mm/yyyy
  toDate: string,
): Promise<Game365[]> {
  const from = encodeURIComponent(fromDate);
  const to = encodeURIComponent(toDate);
  const data = (await fetch365(
    `/games/?appTypeId=5&langId=11&startDate=${from}&endDate=${to}&sports=1`,
  )) as { games?: Game365[] };
  return (data.games ?? []).filter((g) => g.competitionId === COMP_ID_365);
}

// ─── Hämta matchdetaljer ─────────────────────────────────────────────────────

async function fetchGameDetail(gameId: number): Promise<GameDetail365 | null> {
  try {
    const data = (await fetch365(
      `/game/?appTypeId=5&langId=11&gameId=${gameId}`,
    )) as { game?: GameDetail365 };
    return data.game ?? null;
  } catch {
    return null;
  }
}

// ─── Datumhjälp ──────────────────────────────────────────────────────────────

function addDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

function toDdMmYyyy(d: Date): string {
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yyyy = d.getFullYear();
  return `${dd}/${mm}/${yyyy}`;
}

// ─── Bygg match- och spelarrader ─────────────────────────────────────────────

function parseStatValue(val: string | number): number {
  if (typeof val === "number") return val;
  // Format: "1", "5/10 (50%)", "90'"
  const n = parseFloat(String(val).replace(/[^0-9.]/g, ""));
  return isNaN(n) ? 0 : n;
}

function buildPlayerRows(
  game: GameDetail365,
  season: string,
  leagueId: string,
): Array<Record<string, unknown>> {
  const rows: Array<Record<string, unknown>> = [];

  const teams = [
    { competitor: game.homeCompetitor, homeAway: "home" },
    { competitor: game.awayCompetitor, homeAway: "away" },
  ];

  // Red cards from events
  const redCardEvents = game.events.filter(
    (e) => e.eventType?.id === 3 || e.eventType?.name?.toLowerCase().includes("red"),
  );
  const redCardPlayerIds = new Set(redCardEvents.map((e) => e.playerId));

  // Goals from events
  const goalEvents = game.events.filter((e) => e.eventType?.id === 1);
  const goalByPlayer = new Map<number, number>();
  for (const e of goalEvents) {
    if (e.playerId) goalByPlayer.set(e.playerId, (goalByPlayer.get(e.playerId) ?? 0) + 1);
  }

  // Assist from events (extraPlayers on goal events)
  const assistByPlayer = new Map<number, number>();
  for (const e of goalEvents) {
    for (const pid of e.extraPlayers ?? []) {
      assistByPlayer.set(pid, (assistByPlayer.get(pid) ?? 0) + 1);
    }
  }

  for (const { competitor, homeAway } of teams) {
    const lu = competitor.lineups;
    if (!lu?.members?.length) continue;

    for (const member of lu.members) {
      // Hämta spelarinfo från game.members
      const athleteId = (member as any).athleteId ?? (member as any).id;
      const memberId = (member as any).id;
      const fullMember = game.members?.find(
        (m) => m.id === memberId || m.athleteId === athleteId,
      );

      if (!fullMember && !athleteId) continue;

      const playerName = fullMember?.name ?? (member as any).name ?? "Unknown";
      const isStarter = member.status === 1;
      const isSubIn = member.status === 2;
      const position = member.position?.name ?? null;

      // Bygg stats från stats-array
      const statsMap: Record<string, number> = {};
      for (const s of member.stats ?? []) {
        const field = STAT_MAP[s.type];
        if (field) statsMap[field] = parseStatValue(s.value);
      }

      // Komplettera med event-baserade stats
      const pid = athleteId ?? memberId;
      if (pid && goalByPlayer.has(pid)) statsMap.goals = goalByPlayer.get(pid)!;
      if (pid && assistByPlayer.has(pid)) statsMap.assists = assistByPlayer.get(pid)!;
      if (pid && redCardPlayerIds.has(pid)) statsMap.red_cards = 1;

      rows.push({
        league_id: leagueId,
        season,
        event_id: String(game.id),
        event_date: game.startTime,
        athlete_id: String(pid ?? memberId),
        athlete_name: playerName,
        team_id: String(competitor.id),
        team_name: competitor.name,
        home_away: homeAway,
        position: position,
        jersey: fullMember?.jerseyNumber ? String(fullMember.jerseyNumber) : null,
        starter: isStarter,
        subbed_in: isSubIn,
        subbed_out: false,
        goals: statsMap.goals ?? 0,
        assists: statsMap.assists ?? 0,
        own_goals: 0,
        shots: statsMap.shots ?? 0,
        shots_on_target: statsMap.shots_on_target ?? 0,
        saves: statsMap.saves ?? 0,
        shots_faced: 0,
        goals_conceded: statsMap.goals_conceded ?? 0,
        fouls_committed: statsMap.fouls_committed ?? 0,
        fouls_suffered: statsMap.fouls_suffered ?? 0,
        yellow_cards: statsMap.yellow_cards ?? 0,
        red_cards: statsMap.red_cards ?? 0,
        offsides: statsMap.offsides ?? 0,
        fetched_at: new Date().toISOString(),
      });
    }
  }

  return rows;
}

function buildMatchRow(
  game: GameDetail365,
  season: string,
  leagueId: string,
): Record<string, unknown> {
  // Beräkna gula kort från events (type 2 = Yellow Card)
  const yellowEvents = game.events.filter((e) => e.eventType?.id === 2);
  const homeYellow = yellowEvents.filter((e) => e.competitorId === game.homeCompetitor.id).length;
  const awayYellow = yellowEvents.filter((e) => e.competitorId === game.awayCompetitor.id).length;

  const redEvents = game.events.filter((e) => e.eventType?.id === 3 || e.eventType?.name?.toLowerCase().includes("red"));
  const homeRed = redEvents.filter((e) => e.competitorId === game.homeCompetitor.id).length;
  const awayRed = redEvents.filter((e) => e.competitorId === game.awayCompetitor.id).length;

  return {
    league_id: leagueId,
    season,
    event_id: String(game.id),
    event_date: game.startTime,
    home_team_id: String(game.homeCompetitor.id),
    home_team_name: game.homeCompetitor.name,
    away_team_id: String(game.awayCompetitor.id),
    away_team_name: game.awayCompetitor.name,
    home_yellow_cards: homeYellow,
    home_red_cards: homeRed,
    away_yellow_cards: awayYellow,
    away_red_cards: awayRed,
    // Övriga fält null (365scores har inte possession/passnings-data på lagnivå)
    home_possession: null,
    away_possession: null,
    home_passes_total: null,
    home_passes_accurate: null,
    home_pass_pct: null,
    away_passes_total: null,
    away_passes_accurate: null,
    away_pass_pct: null,
    home_shots: null,
    home_shots_on_target: null,
    away_shots: null,
    away_shots_on_target: null,
    home_fouls: null,
    away_fouls: null,
    home_corners: null,
    away_corners: null,
    raw: null,
    fetched_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
}

// ─── Säsongsaggregering ───────────────────────────────────────────────────────

async function upsertSeasonStats(
  sb: SupabaseClient,
  leagueId: string,
  season: string,
): Promise<void> {
  // Hämta alla matchposter för ligan/säsongen
  const { data: rows } = await sb
    .from("football_player_match_stats")
    .select(
      "athlete_id, athlete_name, team_id, team_name, starter, subbed_in, goals, assists, yellow_cards, red_cards, shots, shots_on_target, saves, goals_conceded",
    )
    .eq("league_id", leagueId)
    .eq("season", season);

  if (!rows?.length) return;

  // Aggregera per spelare
  const byPlayer = new Map<
    string,
    {
      athlete_name: string;
      team_id: string;
      team_name: string;
      appearances: number;
      starts: number;
      sub_ins: number;
      goals: number;
      assists: number;
      yellow_cards: number;
      red_cards: number;
      shots: number;
      shots_on_target: number;
      saves: number;
      goals_conceded: number;
    }
  >();

  for (const r of rows) {
    const key = `${r.athlete_id}::${r.team_id}`;
    if (!byPlayer.has(key)) {
      byPlayer.set(key, {
        athlete_name: r.athlete_name ?? "",
        team_id: r.team_id ?? "",
        team_name: r.team_name ?? "",
        appearances: 0,
        starts: 0,
        sub_ins: 0,
        goals: 0,
        assists: 0,
        yellow_cards: 0,
        red_cards: 0,
        shots: 0,
        shots_on_target: 0,
        saves: 0,
        goals_conceded: 0,
      });
    }
    const p = byPlayer.get(key)!;
    p.appearances++;
    if (r.starter) p.starts++;
    if (r.subbed_in) p.sub_ins++;
    p.goals += r.goals ?? 0;
    p.assists += r.assists ?? 0;
    p.yellow_cards += r.yellow_cards ?? 0;
    p.red_cards += r.red_cards ?? 0;
    p.shots += r.shots ?? 0;
    p.shots_on_target += r.shots_on_target ?? 0;
    p.saves += r.saves ?? 0;
    p.goals_conceded += r.goals_conceded ?? 0;
  }

  // Upsert säsongsrader
  const seasonRows = [];
  for (const [key, p] of byPlayer) {
    const [athleteId] = key.split("::");
    const importanceScore =
      p.goals * 3 + p.assists * 2 + p.starts * 0.5 + p.sub_ins * 0.2;
    seasonRows.push({
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
      yellow_cards: p.yellow_cards,
      red_cards: p.red_cards,
      shots: p.shots,
      shots_on_target: p.shots_on_target,
      saves: p.saves,
      goals_conceded: p.goals_conceded,
      importance_score: Math.round(importanceScore * 10) / 10,
      updated_at: new Date().toISOString(),
    });
  }

  // Batcha upserts
  for (let i = 0; i < seasonRows.length; i += 100) {
    await (sb as any)
      .from("football_player_season_stats")
      .upsert(seasonRows.slice(i, i + 100), {
        onConflict: "league_id,season,athlete_id,team_id",
        ignoreDuplicates: false,
      });
  }
  console.log(`  ✓ Säsongsaggregat: ${seasonRows.length} spelare uppdaterade`);
}

// ─── Huvud ────────────────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);
  const seasonArg = args.find((a) => a.startsWith("--season="));
  const season = seasonArg ? seasonArg.split("=")[1] : String(new Date().getFullYear());

  const seasonYear = parseInt(season, 10);
  console.log(`\n=== K-League 1 data-hämtning (${LEAGUE_ID}, säsong ${season}) ===\n`);

  // K-League börjar mars och slutar november
  // Scanna aldrig framåt i tiden (inga avslutade matcher i framtiden)
  const startDate = new Date(Date.UTC(seasonYear, 2, 1));  // 1 mars
  const today = new Date();
  const seasonEndDate = new Date(Date.UTC(seasonYear, 10, 30)); // 30 november
  const endDate = today < seasonEndDate ? today : seasonEndDate;

  // Steg 1: Samla in alla match-IDs dag för dag
  // (365scores trunkerar långa fönster — enskilda dagar ger rätt data)
  console.log("Steg 1: Samlar in alla match-IDs (dag för dag)...");
  const allGames: Game365[] = [];
  let currentDay = new Date(startDate);
  let totalDays = 0;
  let matchDays = 0;

  while (currentDay <= endDate) {
    const dayStr = toDdMmYyyy(currentDay);
    totalDays++;

    try {
      const games = await fetchGamesForWindow(dayStr, dayStr);
      const finished = games.filter((g) => g.statusGroup === 4);
      if (finished.length > 0) {
        allGames.push(...finished);
        matchDays++;
        process.stdout.write(`  ${dayStr}: ${finished.length} matcher\n`);
      }
    } catch (e) {
      // Ignorera timeout-fel för tomma dagar
    }

    await sleep(DELAY_MS);
    currentDay = addDays(currentDay, 1);

    // Progress var 30:e dag
    if (totalDays % 30 === 0) {
      process.stdout.write(`  [${dayStr}] ${totalDays} dagar skannade, ${allGames.length} matcher hittade...\n`);
    }
  }
  console.log(`  Skannade ${totalDays} dagar, ${matchDays} matchdagar, ${allGames.length} matcher`);

  // Ta bort dubbletter
  const uniqueGames = Array.from(new Map(allGames.map((g) => [g.id, g])).values());
  console.log(`\nTotalt hittade: ${uniqueGames.length} avslutade K-League 1 matcher\n`);

  // Kolla vilka som redan finns i DB
  const existingIds = new Set<string>();
  const { data: existing } = await (sb as any)
    .from("football_player_match_stats")
    .select("event_id")
    .eq("league_id", LEAGUE_ID)
    .eq("season", season);
  for (const r of existing ?? []) existingIds.add(r.event_id);
  console.log(`Redan i DB: ${existingIds.size} matcher\n`);

  const toFetch = uniqueGames.filter((g) => !existingIds.has(String(g.id)));
  console.log(`Att hämta: ${toFetch.length} nya matcher\n`);

  // Steg 2: Hämta detaljer för varje match
  let done = 0;
  let skipped = 0;
  let playerRows = 0;

  for (const game of toFetch) {
    const detail = await fetchGameDetail(game.id);

    if (!detail) {
      skipped++;
      await sleep(DELAY_MS);
      continue;
    }

    // Bygg och upsert matchrad
    const matchRow = buildMatchRow(detail, season, LEAGUE_ID);
    await (sb as any)
      .from("football_match_stats")
      .upsert(matchRow, { onConflict: "league_id,event_id", ignoreDuplicates: false });

    // Bygg och upsert spelarrader
    const pRows = buildPlayerRows(detail, season, LEAGUE_ID);
    if (pRows.length > 0) {
      await (sb as any)
        .from("football_player_match_stats")
        .upsert(pRows, {
          onConflict: "league_id,event_id,athlete_id",
          ignoreDuplicates: false,
        });
      playerRows += pRows.length;
    }

    done++;
    if (done % 10 === 0) {
      process.stdout.write(`  Klara: ${done}/${toFetch.length} (skip:${skipped}, spelare:${playerRows})\n`);
    }

    await sleep(DELAY_MS);
  }

  console.log(`\nSteg 2 klart: ${done} matcher, ${playerRows} spelarposter, ${skipped} skip\n`);

  // Steg 3: Uppdatera säsongsaggregat
  console.log("Steg 3: Uppdaterar säsongsaggregat...");
  await upsertSeasonStats(sb, LEAGUE_ID, season);

  console.log("\n=== K-League 1 hämtning klar ===");
}

main().catch(console.error);
