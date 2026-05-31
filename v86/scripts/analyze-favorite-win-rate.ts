/**
 * Analyserar och sparar folkfavoritens vinstfrekvens per streckintervall.
 * Kör: npx tsx v86/scripts/analyze-favorite-win-rate.ts [--no-save]
 */
import { loadEnv } from "../../src/lib/script-env";
import { saveFavoriteWinReport } from "../../src/lib/trav-favorite-win.server";
import { computeFavoriteWinStats, FAVORITE_WIN_BUCKETS } from "../src/favorite-win-stats";

const LOOKBACK_DAYS = 365;

function parseArgs(argv: string[]) {
  return { save: !argv.includes("--no-save") };
}

async function main() {
  loadEnv();
  const { save } = parseArgs(process.argv.slice(2));

  console.log(`Hämtar ATG-data (${LOOKBACK_DAYS} dagar)...`);
  const result = await computeFavoriteWinStats(LOOKBACK_DAYS);

  console.log(`\nFolkfavoritens vinstfrekvens (${result.fromDate} – ${result.toDate})`);
  console.log(`Speltyper: ${result.gameTypes.join(", ")}`);
  console.log(`Unika lopp i intervallen: ${result.racesInBuckets}`);
  console.log(`Utanför intervall (t.ex. <20%): ${result.racesSkippedOutsideBuckets}\n`);

  console.log("| Streck på favorit | Lopp | Favorit vinner | Vinst % |");
  console.log("|-------------------|------|----------------|---------|");
  for (const b of FAVORITE_WIN_BUCKETS) {
    const row = result.buckets.find((x) => x.bucketKey === b.key)!;
    const pct = row.raceCount > 0 ? row.winPct.toFixed(1) : "—";
    console.log(
      `| ${b.key.padEnd(17)} | ${String(row.raceCount).padStart(4)} | ${String(row.favoriteWins).padStart(14)} | ${pct.padStart(6)}% |`,
    );
  }

  console.log(
    `\nTotalt: ${result.racesInBuckets} lopp, favoriten vann ${result.favoriteWins} (${result.winPct.toFixed(1)}%).`,
  );

  if (save) {
    const { reportId, bucketCount } = await saveFavoriteWinReport(result);
    console.log(`\nSparat i databas (report_id=${reportId}, ${bucketCount} intervall, nyckel=${result.reportKey}).`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
