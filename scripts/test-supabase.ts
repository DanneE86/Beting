import { createClient } from "@supabase/supabase-js";
import { loadEnv } from "../src/lib/script-env";

loadEnv();

const url = process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const anonKey = process.env.SUPABASE_PUBLISHABLE_KEY;

const tables = [
  "predictions",
  "archived_seasons",
  "archived_predictions",
  "league_season_state",
  "league_prompts",
  "league_model_params",
  "opta_cache",
  "trav_horse_cache",
  "trav_predictions",
  "trav_learning_prompts",
  "model_learning_prompts",
  "football_match_intel",
  "football_rulebook",
];

async function main() {
  console.log("=== Supabase-anslutningstest ===\n");

  if (!url) {
    console.error("FAIL: SUPABASE_URL saknas");
    process.exit(1);
  }
  console.log("URL:", url);

  if (!serviceKey) {
    console.error("FAIL: SUPABASE_SERVICE_ROLE_KEY saknas");
    process.exit(1);
  }
  if (!anonKey) {
    console.warn("WARN: SUPABASE_PUBLISHABLE_KEY saknas");
  }

  const admin = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  let ok = 0;
  for (const table of tables) {
    const { error, count } = await admin.from(table).select("*", { count: "exact", head: true });
    if (error) {
      console.log(`  ${table}: FAIL — ${error.message}`);
    } else {
      console.log(`  ${table}: OK (${count ?? 0} rader)`);
      ok++;
    }
  }

  if (ok < tables.length) {
    console.log("\n→ Kör supabase/setup-complete.sql i SQL Editor om tabeller saknas.");
    process.exit(1);
  }

  const testRow = {
    league_id: "eng.1",
    home_id: "test-home",
    away_id: "test-away",
    home_name: "Test Home",
    away_name: "Test Away",
    home_win_pct: 40,
    draw_pct: 30,
    away_win_pct: 30,
    predicted_score: "1-1",
    predicted_outcome: "D",
    confidence: "låg",
    betting_tip: "Anslutningstest",
    model_version: 1,
    market_odds_open: { home: 2.1, draw: 3.2, away: 3.6 },
    market_odds_last: { home: 2.05, draw: 3.25, away: 3.75 },
  };

  const { data: inserted, error: insertErr } = await admin
    .from("predictions")
    .insert(testRow)
    .select("id")
    .single();

  if (insertErr) {
    console.log("\nSkrivtest: FAIL —", insertErr.message);
    process.exit(1);
  }

  await admin.from("predictions").delete().eq("id", inserted.id);
  console.log("\nSkrivtest (insert + delete): OK");
  console.log("\n=== Allt fungerar! Kör npm run dev ===");
}

main().catch((e) => {
  console.error("FAIL:", e.message);
  process.exit(1);
});
