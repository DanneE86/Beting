/**
 * Hämtar 3 års matchhistorik från ESPN till Supabase archived_seasons.
 * Kör: npm run backfill
 */
import { backfillLeagueSeasons } from "../src/lib/archive-backfill";
import { LEAGUE_IDS } from "../src/lib/leagues";
import { createScriptSupabase, loadEnv } from "../src/lib/script-env";

loadEnv();
const supabase = createScriptSupabase();

const YEARS = 3;

console.log(`Backfill start — ${LEAGUE_IDS.length} ligor × ${YEARS} år\n`);

let grand = 0;
for (const lg of LEAGUE_IDS) {
  console.log(`\n[${lg}]`);
  try {
    const n = await backfillLeagueSeasons(supabase, lg, {
      years: YEARS,
      delayMs: 400,
      onSeasonSkip: (_id, season, count) => {
        console.log(`  ${season}: redan ${count} matcher, hoppar över`);
      },
      onSeasonStart: (_id, season, fromYmd, toYmd) => {
        console.log(`  ${season}: hämtar ${fromYmd}–${toYmd}...`);
      },
      onSeasonDone: (_id, season, count) => {
        console.log(`  ${season}: sparade ${count} matcher`);
      },
    });
    grand += n;
    console.log(`  Totalt nya: ${n}`);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`  FAIL:`, msg);
  }
}

console.log(`\n=== Klar! ${grand} matcher inskrivna totalt ===`);
console.log("Kör nu: npm run train:models");
