/**
 * Applicerar football_match_intel-migration via Supabase REST (kräver att SQL redan körts
 * eller att tabellerna skapas här via manuell körning).
 * Verifierar tabeller och skapar dem via setup-complete-utdrag om de saknas.
 */
import { loadEnv, createScriptSupabase } from "../src/lib/script-env";
import { readFileSync } from "fs";
import { resolve } from "path";

loadEnv();
const supabase = createScriptSupabase();

async function tableOk(name: string) {
  const { error } = await supabase.from(name).select("id").limit(1);
  return !error || !/schema cache|PGRST205|Could not find/i.test(error.message ?? "");
}

async function main() {
  const intel = await tableOk("football_match_intel");
  const rules = await tableOk("football_rulebook");

  if (intel && rules) {
    console.log("Tabellerna football_match_intel och football_rulebook finns redan.");
    return;
  }

  console.log("Tabeller saknas i Supabase.");
  console.log("");
  console.log("Kör denna SQL i Supabase Dashboard → SQL Editor:");
  console.log("  https://supabase.com/dashboard/project/revmfdtofyewbwwdcrju/sql/new");
  console.log("");
  const sql = readFileSync(
    resolve("supabase/migrations/20260528120000_football_match_intel.sql"),
    "utf8",
  );
  console.log("---");
  console.log(sql);
  console.log("---");
  process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
