/**
 * Hämtar startelvor för alla spelade matcher från ESPN summary-endpoint
 * och sparar dem i tabellen football_match_lineups.
 *
 *   npm run lineups               → alla ligor, max 100 matcher per liga
 *   npm run lineups -- --full    → alla ligor, alla matcher
 *   npm run lineups -- --league=eng.1 --full
 *   npm run lineups -- --limit=500
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { espnGet, summaryUrl } from "../src/lib/espn.api";
import { LEAGUES } from "../src/lib/leagues";
import { createScriptSupabase, loadEnv, sleep } from "../src/lib/script-env";

const DEFAULT_LIMIT_PER_LEAGUE = 100;
const DELAY_MS = 350;

// ─── Typer ────────────────────────────────────────────────────────────────────

type PlayerEntry = {
  id: string;
  name: string;
  position: string;
  jersey: number | null;
};

type LineupRow = {
  league_id: string;
  season: string;
  event_id: string;
  event_date: string | null;
  home_team_id: string | null;
  home_team_name: string | null;
  away_team_id: string | null;
  away_team_name: string | null;
  home_formation: string | null;
  away_formation: string | null;
  home_starters: PlayerEntry[];
  away_starters: PlayerEntry[];
  home_bench: PlayerEntry[];
  away_bench: PlayerEntry[];
  fetched_at: string;
};

// ─── Parsning ─────────────────────────────────────────────────────────────────

function extractFormation(header: any, homeAway: "home" | "away"): string | null {
  const competitors: any[] = header?.competitions?.[0]?.competitors ?? [];
  const comp = competitors.find((c: any) => c.homeAway === homeAway);
  return comp?.formation?.name ?? comp?.formation ?? null;
}

function parseRoster(
  roster: any[],
  isStarter: boolean,
): PlayerEntry[] {
  return roster
    .filter((p: any) => {
      if (isStarter) return p.starter === true;
      return p.starter !== true;
    })
    .map((p: any) => ({
      id: p.athlete?.id ?? "",
      name: p.athlete?.displayName ?? p.athlete?.fullName ?? "",
      position: p.position?.abbreviation ?? p.position?.displayName ?? "",
      jersey: p.jersey != null ? Number(p.jersey) : (p.athlete?.jersey != null ? Number(p.athlete.jersey) : null),
    }))
    .filter((p: PlayerEntry) => p.id !== "");
}

function parseLineup(
  data: Record<string, unknown>,
  eventId: string,
  eventDate: string | null,
): Omit<LineupRow, "league_id" | "season"> | null {
  const rosters: any[] = (data.rosters as any[]) ?? [];
  if (rosters.length === 0) return null;

  const homeRosterBlock = rosters.find((r: any) => r.homeAway === "home");
  const awayRosterBlock = rosters.find((r: any) => r.homeAway === "away");
  if (!homeRosterBlock || !awayRosterBlock) return null;

  const homeRoster: any[] = homeRosterBlock.roster ?? [];
  const awayRoster: any[] = awayRosterBlock.roster ?? [];

  const homeStarters = parseRoster(homeRoster, true);
  const awayStarters = parseRoster(awayRoster, true);

  // Kräv minst ett lag med starters för att raden ska vara meningsfull
  if (homeStarters.length === 0 && awayStarters.length === 0) return null;

  const header = data.header as any;

  return {
    event_id: eventId,
    event_date: eventDate,
    home_team_id: homeRosterBlock.team?.id ?? null,
    home_team_name: homeRosterBlock.team?.displayName ?? null,
    away_team_id: awayRosterBlock.team?.id ?? null,
    away_team_name: awayRosterBlock.team?.displayName ?? null,
    home_formation: extractFormation(header, "home"),
    away_formation: extractFormation(header, "away"),
    home_starters: homeStarters,
    away_starters: awayStarters,
    home_bench: parseRoster(homeRoster, false),
    away_bench: parseRoster(awayRoster, false),
    fetched_at: new Date().toISOString(),
  };
}

// ─── DB-hjälpare ──────────────────────────────────────────────────────────────

async function getAlreadyFetched(
  supabase: SupabaseClient,
  leagueId: string,
): Promise<Set<string>> {
  const { data } = await supabase
    .from("football_match_lineups")
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
    .order("event_date", { ascending: false })
    .limit(limit);
  if (error) throw new Error(`[${leagueId}] archived_seasons: ${error.message}`);
  return (data ?? []) as Array<{ event_id: string; event_date: string; season: string }>;
}

async function saveLineup(
  supabase: SupabaseClient,
  row: LineupRow,
): Promise<void> {
  const { error } = await supabase
    .from("football_match_lineups")
    .upsert(row, { onConflict: "league_id,event_id" });
  if (error) throw new Error(`save lineup ${row.event_id}: ${error.message}`);
}

// ─── Per-liga pipeline ─────────────────────────────────────────────────────────

async function processLeague(
  supabase: SupabaseClient,
  leagueId: string,
  opts: { limit: number },
): Promise<{ fetched: number; skipped: number; noLineup: number }> {
  const events = await getEventsForLeague(supabase, leagueId, opts.limit);
  if (events.length === 0) return { fetched: 0, skipped: 0, noLineup: 0 };

  const already = await getAlreadyFetched(supabase, leagueId);

  let fetched = 0;
  let skipped = 0;
  let noLineup = 0;

  for (const ev of events) {
    if (already.has(ev.event_id)) {
      skipped++;
      continue;
    }

    try {
      const url = summaryUrl(leagueId, ev.event_id);
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

      const parsed = parseLineup(data, ev.event_id, ev.event_date);
      if (!parsed) {
        noLineup++;
      } else {
        await saveLineup(supabase, {
          league_id: leagueId,
          season: ev.season,
          ...parsed,
        });
        fetched++;
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`  [${leagueId}] ${ev.event_id}: ${msg}`);
    }

    await sleep(DELAY_MS);
  }

  return { fetched, skipped, noLineup };
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
  return { leagueFilter, limit };
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
  console.log(`\n=== Hämtar startelvor (${mode}) ===`);
  console.log(`Ligor: ${leagues.map((l) => l.id).join(", ")}\n`);

  let grandFetched = 0;
  let grandSkipped = 0;
  let grandNoLineup = 0;
  const errors: string[] = [];

  for (const league of leagues) {
    const t0 = Date.now();
    process.stdout.write(`▶ ${league.name} (${league.id})… `);
    try {
      const { fetched, skipped, noLineup } = await processLeague(supabase, league.id, { limit });
      const sec = ((Date.now() - t0) / 1000).toFixed(1);
      console.log(`✓ ${fetched} sparade, ${skipped} skip, ${noLineup} saknar elva (${sec}s)`);
      grandFetched += fetched;
      grandSkipped += skipped;
      grandNoLineup += noLineup;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.log(`✗ ${msg}`);
      errors.push(`${league.id}: ${msg}`);
    }
  }

  console.log(`\n=== Klart ===`);
  console.log(`Startelvor sparade: ${grandFetched}`);
  console.log(`Matcher skip:       ${grandSkipped}`);
  console.log(`Saknar elva:        ${grandNoLineup}`);
  if (errors.length) {
    console.log(`Fel (${errors.length}):`);
    errors.forEach((e) => console.log(`  ${e}`));
  }
}

const entry = process.argv[1]?.replace(/\\/g, "/") ?? "";
if (entry.endsWith("fetch-lineups.ts")) {
  main().catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  });
}

export { main as fetchLineupsMain };
