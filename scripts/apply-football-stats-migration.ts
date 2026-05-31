/**
 * Kontrollerar om football_match_stats och football_player_season_stats finns.
 * Om inte — skriver ut SQL:en som ska kopieras till Supabase SQL Editor.
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

async function main() {
  const matchStats = await tableOk("football_match_stats");
  const playerStats = await tableOk("football_player_season_stats");

  if (matchStats && playerStats) {
    console.log("OK: football_match_stats och football_player_season_stats finns redan.");
    return;
  }

  console.log("Tabeller saknas:");
  if (!matchStats) console.log("  - football_match_stats");
  if (!playerStats) console.log("  - football_player_season_stats");
  console.log("");
  console.log("Kor denna SQL i Supabase Dashboard -> SQL Editor:");
  console.log("  https://supabase.com/dashboard/project/_/sql/new");
  console.log("");
  const sql = readFileSync(
    resolve("supabase/migrations/20260528160000_football_stats.sql"),
    "utf8",
  );
  console.log("--- KOPIERA DENNA SQL ---");
  console.log(sql);
  console.log("--- SLUT ---");
  process.exit(1);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
