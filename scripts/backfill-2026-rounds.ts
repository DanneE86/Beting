/**
 * Fyller på trav_predictions med alla V85/V86-omgångar 2026 (status=results).
 * Sparar snapshot + resolvar (resultat + postmortem) för varje omgång.
 *
 * Kör: npx tsx scripts/backfill-2026-rounds.ts [flaggor]
 * Flaggor:
 *   --rules=rule6            Kommaseparerade regel-ID:n (default: rule6)
 *   --from=2026-01-01        Startdatum (default: 2026-01-01)
 *   --game-types=V85,V86     Speltyper (default: V85,V86)
 *   --dry-run                Visa vad som skulle göras, spara inget
 */
import { loadEnv, createScriptSupabase, sleep } from "../src/lib/script-env";
import { fetchCalendarDay, fetchGame, listAllowedGamesFromCalendar } from "../v86/src/atg-api";
import { buildSnapshotFromGame, sanitizeHistoricalGameForPrematch } from "../v86/src/pipeline";
import { saveTravPrediction, resolveTravPredictionRow } from "../src/lib/trav-learning.server";
import { fileCacheBackend } from "../v86/src/travsport/file-cache";
import type { PoolGameType } from "../v86/src/types";

const args = process.argv.slice(2);
const fromDate = args.find((a) => a.startsWith("--from="))?.slice("--from=".length) ?? "2026-01-01";
const gameTypesArg = args.find((a) => a.startsWith("--game-types="))?.slice("--game-types=".length) ?? "V85,V86";
const gameTypes = gameTypesArg.split(",").map((s) => s.trim()) as PoolGameType[];
const dryRun = args.includes("--dry-run");

function addDaysIso(date: string, days: number): string {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

async function loadDoneKeys(supabase: ReturnType<typeof createScriptSupabase>): Promise<Set<string>> {
  const { data, error } = await supabase
    .from("trav_predictions")
    .select("game_id, meta_json")
    .not("resolved_at", "is", null);
  if (error) {
    console.warn("Kunde inte läsa befintliga rader:", error.message);
    return new Set();
  }
  const done = new Set<string>();
  for (const row of data ?? []) {
    const meta = (row.meta_json ?? {}) as Record<string, unknown>;
    if (String(meta.source ?? "live") !== "historical-backtest") continue;
    done.add(row.game_id);
  }
  return done;
}

async function main() {
  loadEnv();
  const supabase = createScriptSupabase();

  const toDate = todayIso();
  console.log(`Backfill ${gameTypes.join(",")} från ${fromDate} till ${toDate}`);
  console.log(`dry-run: ${dryRun}\n`);

  const done = await loadDoneKeys(supabase);
  console.log(`Redan i DB (resolved): ${done.size} omgångar\n`);

  const dates: string[] = [];
  for (let d = fromDate; d <= toDate; d = addDaysIso(d, 1)) {
    dates.push(d);
  }

  let saved = 0;
  let wouldSave = 0;
  let skipped = 0;
  let errors = 0;

  for (const date of dates) {
    const calendar = await fetchCalendarDay(date).catch(() => null);
    if (!calendar?.games) continue;

    const matchingTypes = listAllowedGamesFromCalendar(calendar.games).filter((g) =>
      gameTypes.includes(g.type),
    );
    if (matchingTypes.length === 0) continue;

    for (const { type, entries } of matchingTypes) {
      for (const entry of entries) {
        if (done.has(entry.id)) {
          skipped++;
          continue;
        }

        if (dryRun) {
          console.log(`[dry-run] ${date} ${type} ${entry.id}`);
          wouldSave++;
          continue;
        }

        try {
          const fullGame = await fetchGame(entry.id).catch(() => null);
          if (!fullGame || fullGame.status !== "results") continue;

          const gameDate =
            fullGame.races[0]?.date?.slice(0, 10) ??
            fullGame.races[0]?.startTime?.slice(0, 10) ??
            date;

          const prematch = sanitizeHistoricalGameForPrematch(fullGame);
          const snapshot = await buildSnapshotFromGame(prematch, {
            autoBudget: true,
            includeTravsport: true,
            travsportDbCache: fileCacheBackend,
            travsportAllowStaleCache: true,
          });

          const snapshotWithMeta = {
            ...snapshot,
            meta: {
              ...snapshot.meta,
              source: "historical-backtest" as const,
              backtestDate: gameDate,
            },
          };

          const { id: rowId, error: saveError } = await saveTravPrediction(snapshotWithMeta, {
            source: "historical-backtest",
            backtestDate: gameDate,
            dedupe: true,
          });

          if (!rowId) {
            console.warn(`  ✗ ${date} ${type} ${entry.id}: ${saveError}`);
            errors++;
            continue;
          }

          const postmortem = await resolveTravPredictionRow(rowId, snapshotWithMeta, fullGame);
          if (!postmortem) {
            console.warn(`  ✗ ${date} ${type} ${entry.id}: resolve misslyckades`);
            errors++;
            continue;
          }

          done.add(entry.id);
          saved++;
          console.log(
            `  ✓ ${gameDate} ${type} ${entry.id.slice(-8)} ${snapshot.system?.selections?.length ?? "?"} rader – ${postmortem.verdict}`,
          );
        } catch (err) {
          console.error(`  ✗ ${date} ${type} ${entry.id}: ${err}`);
          errors++;
        }

        await sleep(300);
      }
    }
  }

  if (dryRun) {
    console.log(`\n[dry-run] Skulle spara ${wouldSave} nya, ${skipped} hoppas redan över`);
  } else {
    console.log(`\nKlart: ${saved} sparade & resolvade, ${skipped} hoppades över, ${errors} fel`);
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
