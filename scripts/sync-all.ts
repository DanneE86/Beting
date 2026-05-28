/**
 * Synkar all extern data till projektet.
 *
 *   npm run sync              → Opta + V86 (snabb, daglig)
 *   npm run sync:full         → + ESPN-arkiv + ligamodeller (lång)
 *   npm run sync -- --only=opta,v86
 *   npm run sync -- --skip=v86
 *   npm run sync -- --help
 */
import { backfillLeagueSeasons } from "../src/lib/archive-backfill";
import { updateGlobalFootballPromptFromLatestMatches } from "../src/lib/football-global-learning.server";
import {
  fetchArchivedRowsForLeague,
  trainLeagueFromRows,
} from "../src/lib/league-training";
import { LEAGUE_IDS } from "../src/lib/leagues";
import { formatOptaMatchSummary } from "../src/lib/opta.utils";
import { fetchOptaLiveScores } from "../src/lib/opta.scraper";
import { createScriptSupabase, loadEnv } from "../src/lib/script-env";
import { runV86Pipeline } from "../v86/src/run";
import {
  runFootballAnalyze,
  runFootballIngest,
  runFootballRulebookTrain,
} from "../src/lib/football-intel-pipeline";

const STEP_IDS = ["opta", "v86", "backfill", "train", "football"] as const;
type StepId = (typeof STEP_IDS)[number];

const BACKFILL_YEARS = 3;
const BACKFILL_DELAY_MS = 400;

type StepResult = { id: StepId; ok: boolean; ms: number; detail?: string; error?: string };

function parseArgs(argv: string[]) {
  const only: StepId[] = [];
  const skip = new Set<StepId>();
  let full = false;
  let strict = false;
  let help = false;

  for (const arg of argv) {
    if (arg === "--help" || arg === "-h") help = true;
    else if (arg === "--full") full = true;
    else if (arg === "--strict") strict = true;
    else if (arg.startsWith("--only=")) {
      for (const part of arg.slice(7).split(",")) {
        const id = part.trim() as StepId;
        if (STEP_IDS.includes(id)) only.push(id);
      }
    } else if (arg.startsWith("--skip=")) {
      for (const part of arg.slice(7).split(",")) {
        const id = part.trim() as StepId;
        if (STEP_IDS.includes(id)) skip.add(id);
      }
    }
  }

  let steps: StepId[];
  if (only.length > 0) steps = only;
  else if (full) steps = [...STEP_IDS];
  else steps = ["opta", "v86"];

  steps = steps.filter((s) => !skip.has(s));
  return { steps, full, strict, help };
}

function printHelp() {
  console.log(`
Synka all data — ett kommando för hela projektet

  npm run sync                 Opta (Supabase) + V86/ATG (v86/output/)
  npm run sync:full            + ESPN-arkiv (backfill) + träna ligamodeller

Flaggor:
  --full                       Inkludera backfill + train
  --only=opta,v86,backfill,train
  --skip=v86                   Hoppa över valda steg
  --strict                     Avbryt vid första fel (standard: fortsätt)

Steg:
  opta      Livescores → Supabase opta_cache (Playwright)
  v86       ATG-spel → v86/output/*.json
  backfill  ESPN matchhistorik → archived_seasons (lång)
  train     Ligamodeller från arkiv → league_model_params
  football  Ingest sept+ → analys → regelbok (npm run football:pipeline)
`);
}

async function runOpta(): Promise<string> {
  const data = await fetchOptaLiveScores({ headed: true });
  const supabase = createScriptSupabase();
  const { error } = await supabase.from("opta_cache").upsert(
    {
      cache_key: "livescores",
      payload: data,
      fetched_at: data.fetchedAt,
    },
    { onConflict: "cache_key" },
  );
  if (error) {
    if (error.message.includes("opta_cache")) {
      throw new Error(
        "Tabellen opta_cache saknas. Kör: supabase/migrations/20260524100000_opta_cache.sql",
      );
    }
    throw new Error(error.message);
  }
  for (const m of data.matches.slice(0, 3)) {
    console.log(`    ${formatOptaMatchSummary(m)}`);
  }
  if (data.matches.length > 3) console.log(`    … +${data.matches.length - 3} matcher`);
  return `${data.matches.length} matcher`;
}

async function runV86(): Promise<string> {
  const snapshot = await runV86Pipeline([]);
  return `${snapshot.game.type} ${snapshot.game.id}`;
}

async function runBackfill(): Promise<string> {
  const supabase = createScriptSupabase();
  let grand = 0;
  for (const lg of LEAGUE_IDS) {
    console.log(`    [${lg}]`);
    const n = await backfillLeagueSeasons(supabase, lg, {
      years: BACKFILL_YEARS,
      delayMs: BACKFILL_DELAY_MS,
      onSeasonSkip: (_id, season, count) => {
        console.log(`      ${season}: redan ${count}, hoppar över`);
      },
      onSeasonStart: (_id, season, from, to) => {
        console.log(`      ${season}: ${from}–${to}…`);
      },
      onSeasonDone: (_id, season, count) => {
        console.log(`      ${season}: +${count}`);
      },
    });
    grand += n;
  }
  return `${grand} nya matcher`;
}

async function runTrain(): Promise<string> {
  const supabase = createScriptSupabase();
  let trained = 0;
  let totalMatches = 0;
  for (const leagueId of LEAGUE_IDS) {
    const rows = await fetchArchivedRowsForLeague(supabase, leagueId);
    totalMatches += rows.length;
    if (rows.length === 0) continue;
    const params = trainLeagueFromRows(leagueId, rows);
    if (!params) continue;
    const { error } = await supabase.from("league_model_params").upsert(params);
    if (error) {
      if (error.message.includes("league_model_params")) {
        throw new Error(
          "Tabellen league_model_params saknas. Kör migration i supabase/migrations/",
        );
      }
      throw new Error(`${leagueId}: ${error.message}`);
    }
    trained++;
    console.log(`    ${leagueId}: ${rows.length} matcher tränade`);
  }
  const footballGlobal = await updateGlobalFootballPromptFromLatestMatches(500);
  console.log(`    football-global: ${footballGlobal.sampleCount} matcher + resolverade lärdomar`);
  return `${trained} ligor (${totalMatches} matcher granskade) + football-global`;
}

async function runFootball(): Promise<string> {
  const supabase = createScriptSupabase();
  const ing = await runFootballIngest(supabase);
  const an = await runFootballAnalyze(supabase);
  const rb = await runFootballRulebookTrain(supabase);
  return `ingest ${ing.totalMatches}, analyze ${an.analyzed}, regelbok v${rb.version} (${(rb.backtest.rulebookHitRate * 100).toFixed(1)}%)`;
}

const STEP_RUNNERS: Record<StepId, { label: string; run: () => Promise<string> }> = {
  opta: { label: "Opta livescores → Supabase", run: runOpta },
  v86: { label: "V86 / ATG → v86/output", run: runV86 },
  backfill: { label: "ESPN-arkiv → Supabase", run: runBackfill },
  train: { label: "Träna ligamodeller", run: runTrain },
  football: { label: "Fotboll ingest + analys + regelbok", run: runFootball },
};

async function runStep(id: StepId): Promise<StepResult> {
  const { label, run } = STEP_RUNNERS[id];
  const t0 = Date.now();
  console.log(`\n▶ ${label}`);
  try {
    const detail = await run();
    const ms = Date.now() - t0;
    console.log(`✓ Klar (${(ms / 1000).toFixed(1)}s) — ${detail}`);
    return { id, ok: true, ms, detail };
  } catch (e) {
    const ms = Date.now() - t0;
    const error = e instanceof Error ? e.message : String(e);
    console.error(`✗ Misslyckades (${(ms / 1000).toFixed(1)}s) — ${error}`);
    return { id, ok: false, ms, error };
  }
}

export async function main(argv = process.argv.slice(2)) {
  const { steps, help, strict } = parseArgs(argv);
  if (help || steps.length === 0) {
    printHelp();
    process.exit(help ? 0 : 1);
  }

  loadEnv();
  console.log("=== Datasynk ===");
  console.log(`Steg: ${steps.join(" → ")}`);

  const results: StepResult[] = [];
  for (const id of steps) {
    const result = await runStep(id);
    results.push(result);
    if (!result.ok && strict) break;
  }

  const ok = results.filter((r) => r.ok);
  const fail = results.filter((r) => !r.ok);
  const totalSec = (results.reduce((s, r) => s + r.ms, 0) / 1000).toFixed(1);

  console.log("\n=== Sammanfattning ===");
  console.log(`Lyckades: ${ok.map((r) => r.id).join(", ") || "—"}`);
  if (fail.length) console.log(`Misslyckades: ${fail.map((r) => `${r.id} (${r.error})`).join("; ")}`);
  console.log(`Tid: ${totalSec}s`);

  if (fail.length) process.exit(1);
}

const entry = process.argv[1]?.replace(/\\/g, "/") ?? "";
if (entry.endsWith("sync-all.ts")) {
  main().catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  });
}
