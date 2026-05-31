/**
 * Kontrollerar om football_player_match_stats och nya kolumner i
 * football_player_season_stats finns på remote Supabase.
 * Om inte — skriver ut SQL:en att köra i SQL Editor.
 */
import { loadEnv, createScriptSupabase } from "../src/lib/script-env";
import { readFileSync } from "fs";
import { resolve } from "path";

loadEnv();
const supabase = createScriptSupabase();

async function tableOk(name: string): Promise<boolean> {
  const { error } = await supabase.from(name).select("id").limit(1);
  return !error || !/schema cache|PGRST205|Could not find/i.test(error.message ?? "");
}

async function columnOk(table: string, col: string): Promise<boolean> {
  const { error } = await supabase.from(table).select(col).limit(1);
  return !error || !/schema cache|PGRST205|Could not find/i.test(error.message ?? "");
}

async function main() {
  const matchStatsOk = await tableOk("football_player_match_stats");
  const foulsOk = await columnOk("football_player_season_stats", "fouls_committed");

  if (matchStatsOk && foulsOk) {
    console.log("OK: football_player_match_stats och alla kolumner finns redan.");
    return;
  }

  console.log("Saknas:");
  if (!matchStatsOk) console.log("  - tabell: football_player_match_stats");
  if (!foulsOk) console.log("  - kolumner: fouls_committed, fouls_suffered, offsides, own_goals, shots_faced i football_player_season_stats");
  console.log("");
  console.log("Kor denna SQL i Supabase Dashboard -> SQL Editor:");
  console.log("  https://supabase.com/dashboard/project/revmfdtofyewbwwdcrju/sql/new");
  console.log("");

  const sqls: string[] = [];
  if (!matchStatsOk) {
    sqls.push(readFileSync(resolve("supabase/migrations/20260530020000_football_player_match_stats.sql"), "utf8"));
  }
  if (!foulsOk) {
    sqls.push(readFileSync(resolve("supabase/migrations/20260530030000_football_player_season_stats_v2.sql"), "utf8"));
  }

  console.log("--- KOPIERA DENNA SQL ---");
  console.log(sqls.join("\n\n"));
  console.log("--- SLUT ---");
  process.exit(1);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
