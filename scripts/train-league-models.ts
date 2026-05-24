/**
 * Tränar ligaspecifika modellparametrar från archived_seasons.
 * Kör efter backfill: npm run train:models
 */
import {
  fetchArchivedRowsForLeague,
  trainLeagueFromRows,
} from "../src/lib/league-training";
import { LEAGUE_IDS } from "../src/lib/leagues";
import { createScriptSupabase, loadEnv } from "../src/lib/script-env";

loadEnv();
const supabase = createScriptSupabase();

console.log("=== Tränar ligamodeller från archived_seasons ===\n");

let totalMatches = 0;
let trained = 0;
let skipped = 0;

for (const leagueId of LEAGUE_IDS) {
  let rows;
  try {
    rows = await fetchArchivedRowsForLeague(supabase, leagueId);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`${leagueId}: hämtning misslyckades —`, msg);
    continue;
  }

  totalMatches += rows.length;
  if (rows.length === 0) {
    console.log(`${leagueId}: ingen data, skippar`);
    skipped++;
    continue;
  }

  const params = trainLeagueFromRows(leagueId, rows);
  if (!params) {
    console.log(`${leagueId}: för få matcher (${rows.length}), skippar`);
    skipped++;
    continue;
  }

  const { error: upErr } = await supabase.from("league_model_params").upsert(params);
  if (upErr) {
    console.error(`${leagueId}: sparfail —`, upErr.message);
    if (upErr.message.includes("league_model_params")) {
      console.error("  → Kör migration: supabase/migrations/20260524090000_league_model_params.sql");
      process.exit(1);
    }
    continue;
  }

  trained++;
  console.log(
    `${leagueId}: ${rows.length} matcher | H/X/2 ${(params.home_win_rate * 100).toFixed(0)}/${(params.draw_rate * 100).toFixed(0)}/${(params.away_win_rate * 100).toFixed(0)}% | hemmafördel ${params.home_advantage} | backtest träff ${(params.backtest_hit_rate * 100).toFixed(0)}% Brier ${params.backtest_brier}`,
  );
}

console.log(`\nTotalt ${totalMatches} matcher granskade`);
console.log(`=== Klar: ${trained} ligor tränade, ${skipped} skippar ===`);
