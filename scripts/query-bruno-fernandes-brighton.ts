import { loadEnv } from "../src/lib/script-env";
import { createClient } from "@supabase/supabase-js";

loadEnv();

const sb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

function findPlayerPassesInEspnSummary(summary: unknown, playerName: string): Record<string, unknown> | null {
  if (!summary || typeof summary !== "object") return null;
  const boxscore = (summary as { boxscore?: { players?: unknown[] } }).boxscore;
  const teams = boxscore?.players as
    | Array<{
        team?: { displayName?: string };
        athletes?: Array<{
          athlete?: { displayName?: string; fullName?: string };
          stats?: Array<{ name: string; value?: number; displayValue?: string }>;
        }>;
      }>
    | undefined;
  if (!teams) return null;

  const needle = playerName.toLowerCase();
  for (const team of teams) {
    for (const entry of team.athletes ?? []) {
      const name = (entry.athlete?.displayName ?? entry.athlete?.fullName ?? "").toLowerCase();
      if (!name.includes(needle) && !name.includes("bruno fernandes")) continue;
      const out: Record<string, unknown> = {
        team: team.team?.displayName,
        player: entry.athlete?.displayName ?? entry.athlete?.fullName,
      };
      for (const s of entry.stats ?? []) {
        if (/pass/i.test(s.name)) out[s.name] = s.value ?? s.displayValue;
      }
      return out;
    }
  }
  return null;
}

function findPlayerPassesInRaw(raw: unknown, playerName: string): Record<string, unknown> | null {
  if (!raw || typeof raw !== "object") return null;
  const teams = (raw as { boxscore_players?: unknown[]; boxscore_teams?: unknown[] }).boxscore_players as
    | Array<{
        team?: { displayName?: string };
        athletes?: Array<{
          athlete?: { displayName?: string };
          stats?: Array<{ name: string; value?: number; displayValue?: string }>;
        }>;
      }>
    | undefined;
  if (!teams) return null;
  const needle = playerName.toLowerCase();
  for (const team of teams) {
    for (const entry of team.athletes ?? []) {
      const name = (entry.athlete?.displayName ?? "").toLowerCase();
      if (!name.includes(needle) && !name.includes("bruno fernandes")) continue;
      const out: Record<string, unknown> = {
        team: team.team?.displayName,
        player: entry.athlete?.displayName,
      };
      for (const s of entry.stats ?? []) {
        if (/pass/i.test(s.name)) out[s.name] = s.value ?? s.displayValue;
      }
      return out;
    }
  }
  return null;
}

async function main() {
  const { data: intel, error: intelErr } = await sb
    .from("football_match_intel")
    .select("event_id,event_date,home_name,away_name,home_score,away_score,league_id,season,espn_summary")
    .eq("league_id", "eng.1")
    .ilike("home_name", "%Brighton%")
    .ilike("away_name", "%Manchester United%")
    .order("event_date", { ascending: false })
    .limit(5);

  if (intelErr) console.log("intel error:", intelErr.message);

  const { data: intelRev } = await sb
    .from("football_match_intel")
    .select("event_id,event_date,home_name,away_name,home_score,away_score,league_id,season,espn_summary")
    .eq("league_id", "eng.1")
    .ilike("home_name", "%Manchester United%")
    .ilike("away_name", "%Brighton%")
    .order("event_date", { ascending: false })
    .limit(5);

  const matches = [...(intel ?? []), ...(intelRev ?? [])].sort((a, b) =>
    (b.event_date ?? "").localeCompare(a.event_date ?? ""),
  );

  console.log("=== football_match_intel (Brighton vs Man United, PL) ===\n");
  if (matches.length === 0) {
    console.log("Ingen match hittad i football_match_intel.");
  } else {
    for (const m of matches) {
      console.log(`${m.event_date?.slice(0, 10)} | ${m.home_name} ${m.home_score}-${m.away_score} ${m.away_name} | ${m.event_id}`);
      const passes = findPlayerPassesInEspnSummary(m.espn_summary, "Fernandes");
      console.log("Bruno Fernandes (espn_summary):", passes ?? "inga passningsfält i sparad data");
    }
  }

  const { data: stats, error: statsErr } = await sb
    .from("football_match_stats")
    .select("event_id,event_date,home_team_name,away_team_name,home_passes_total,away_passes_total,raw")
    .ilike("home_team_name", "%Brighton%")
    .ilike("away_team_name", "%Manchester United%")
    .order("event_date", { ascending: false })
    .limit(3);

  if (statsErr) console.log("stats error:", statsErr.message);

  console.log("\n=== football_match_stats ===\n");
  if (!stats?.length) {
    console.log("Ingen rad för Brighton–Man United.");
  } else {
    for (const m of stats) {
      console.log(`${m.event_date?.slice(0, 10)} | ${m.home_team_name} vs ${m.away_team_name}`);
      console.log(`Lagpass: Brighton ${m.home_passes_total} | United ${m.away_passes_total}`);
      const passes = findPlayerPassesInRaw(m.raw, "Fernandes");
      console.log("Bruno Fernandes (raw):", passes ?? "inga spelardata i raw");
    }
  }

  const { data: players } = await sb
    .from("football_player_season_stats")
    .select("*")
    .eq("league_id", "eng.1")
    .ilike("athlete_name", "%Fernandes%")
    .limit(5);

  console.log("\n=== football_player_season_stats (säsong, ej per match) ===\n");
  console.log(players?.length ? players : "Ingen Fernandes-rad (tabellen har ej pass per match).");
}

main().catch(console.error);
