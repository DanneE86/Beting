/**
 * Sparar senaste favoritvinst-analys till Supabase (samma som v86/scripts/analyze-favorite-win-rate.ts).
 * Kör: npx tsx scripts/save-trav-favorite-win-stats.ts
 */
import { loadEnv } from "../src/lib/script-env";
import { saveFavoriteWinReport } from "../src/lib/trav-favorite-win.server";
import {
  computeFavoriteWinStats,
  type FavoriteWinStatsResult,
} from "../v86/src/favorite-win-stats";

/** Senast beräknade värden (kan uppdateras med full körning). */
const SEED_SNAPSHOT: FavoriteWinStatsResult = {
  reportKey: "rolling-365d",
  fromDate: "2025-05-29",
  toDate: "2026-05-28",
  lookbackDays: 365,
  gameTypes: ["V85", "V86", "dd"],
  racesInBuckets: 1167,
  favoriteWins: 445,
  winPct: 38.1,
  racesSkippedOutsideBuckets: 133,
  buckets: [
    { bucketKey: "20-30%", streckMin: 20, streckMax: 30, sortOrder: 1, raceCount: 253, favoriteWins: 58, winPct: 22.9 },
    { bucketKey: "31-40%", streckMin: 31, streckMax: 40, sortOrder: 2, raceCount: 391, favoriteWins: 121, winPct: 30.9 },
    { bucketKey: "41-50%", streckMin: 41, streckMax: 50, sortOrder: 3, raceCount: 242, favoriteWins: 102, winPct: 42.1 },
    { bucketKey: "51-60%", streckMin: 51, streckMax: 60, sortOrder: 4, raceCount: 148, favoriteWins: 74, winPct: 50.0 },
    { bucketKey: "61-70%", streckMin: 61, streckMax: 70, sortOrder: 5, raceCount: 74, favoriteWins: 42, winPct: 56.8 },
    { bucketKey: "71-80%", streckMin: 71, streckMax: 80, sortOrder: 6, raceCount: 38, favoriteWins: 30, winPct: 78.9 },
    { bucketKey: "81-100%", streckMin: 81, streckMax: 100, sortOrder: 7, raceCount: 21, favoriteWins: 18, winPct: 85.7 },
  ],
};

async function main() {
  loadEnv();
  const seedOnly = process.argv.includes("--seed-only");
  const lookbackDays = Number(process.env.TRAV_FAVORITE_LOOKBACK_DAYS ?? 365);

  const result = seedOnly
    ? SEED_SNAPSHOT
    : await (async () => {
        console.log(`Beräknar favoritstatistik (${lookbackDays} dagar)...`);
        return computeFavoriteWinStats(lookbackDays);
      })();
  const { reportId, bucketCount, storage } = await saveFavoriteWinReport(result);
  console.log(
    JSON.stringify(
      {
        ok: true,
        storage,
        reportId,
        reportKey: result.reportKey,
        fromDate: result.fromDate,
        toDate: result.toDate,
        racesInBuckets: result.racesInBuckets,
        favoriteWins: result.favoriteWins,
        winPct: result.winPct,
        bucketCount,
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
