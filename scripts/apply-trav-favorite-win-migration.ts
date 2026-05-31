/**
 * Verifierar att favoritvinst-tabellerna finns; annars skrivs SQL till konsolen.
 */
import { readFileSync } from "fs";
import { resolve } from "path";
import { createScriptSupabase, loadEnv } from "../src/lib/script-env";

loadEnv();

const MIGRATION = resolve("supabase/migrations/20260528140000_trav_favorite_win_stats.sql");

async function main() {
  const supabase = createScriptSupabase();
  const { error } = await supabase.from("trav_favorite_win_reports").select("id").limit(1);
  if (!error) {
    console.log("Tabellerna trav_favorite_win_reports och trav_favorite_win_buckets finns.");
    return;
  }

  console.log("Tabellerna saknas. Kör SQL i Supabase Dashboard → SQL Editor:");
  console.log("  https://supabase.com/dashboard/project/revmfdtofyewbwwdcrju/sql/new\n");
  console.log(readFileSync(MIGRATION, "utf8"));
  process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
