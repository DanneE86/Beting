/**
 * Full fotbollspipeline: ingest → Opta → analys → regelbok → backtest
 *
 *   npm run football:pipeline              alla steg
 *   npm run football:pipeline -- --only=ingest,analyze,rules
 *   npm run football:pipeline -- --skip=opta
 */
import { loadEnv, createScriptSupabase } from "../src/lib/script-env";
import {
  runFootballAnalyze,
  runFootballIngest,
  runFootballOptaEnrich,
  runFootballRulebookTrain,
  type PipelineStepResult,
} from "../src/lib/football-intel-pipeline";

const STEPS = ["ingest", "opta", "analyze", "rules"] as const;
type StepId = (typeof STEPS)[number];

function parseArgs(argv: string[]) {
  const only: StepId[] = [];
  const skip = new Set<StepId>();
  let help = false;
  let analyzeLimit: number | undefined;
  let skipOpta = false;

  for (const arg of argv) {
    if (arg === "--help" || arg === "-h") help = true;
    else if (arg.startsWith("--only=")) {
      for (const p of arg.slice(7).split(",")) {
        const id = p.trim() as StepId;
        if (STEPS.includes(id)) only.push(id);
      }
    } else if (arg.startsWith("--skip=")) {
      for (const p of arg.slice(7).split(",")) {
        const id = p.trim() as StepId;
        if (STEPS.includes(id)) skip.add(id);
      }
    } else if (arg.startsWith("--analyze-limit=")) {
      analyzeLimit = Number(arg.slice(16));
    } else if (arg === "--skip-opta") skipOpta = true;
  }

  let steps: StepId[] = only.length ? only : [...STEPS];
  if (skipOpta) skip.add("opta");
  steps = steps.filter((s) => !skip.has(s));
  return { steps, help, analyzeLimit };
}

function printHelp() {
  console.log(`
Fotbollspipeline — matcher sedan sept 2025, analys & regelbok

  npm run football:pipeline
  npm run football:pipeline -- --only=ingest,analyze,rules
  npm run football:pipeline -- --skip=opta
  npm run football:pipeline -- --analyze-limit=200

Steg:
  ingest   ESPN → archived_seasons (alla ligor i leagues.ts)
  opta     Playwright → Opta + football_match_intel (kräver headed/session)
  analyze  Per-match varför-resultat → football_match_intel
  rules    Bygg regelbok + walk-forward backtest → football_rulebook
`);
}

async function runStep(
  id: StepId,
  supabase: ReturnType<typeof createScriptSupabase>,
  analyzeLimit?: number,
): Promise<PipelineStepResult> {
  try {
    switch (id) {
      case "ingest": {
        const { totalMatches } = await runFootballIngest(supabase);
        return { step: id, ok: true, detail: `${totalMatches} matcher upsertade` };
      }
      case "opta": {
        const r = await runFootballOptaEnrich(supabase, { headed: true });
        return {
          step: id,
          ok: true,
          detail: `Opta ${r.optaMatchesFetched} matcher, ${r.archivedMatched} kopplade`,
        };
      }
      case "analyze": {
        const r = await runFootballAnalyze(supabase, {
          enrichEspnSummary: false,
          limit: analyzeLimit,
        });
        return { step: id, ok: true, detail: `${r.analyzed} analyserade, ${r.skipped} hoppade` };
      }
      case "rules": {
        const r = await runFootballRulebookTrain(supabase);
        const bt = r.backtest;
        return {
          step: id,
          ok: true,
          detail:
            `v${r.version}: ${r.rules.length} regler | baseline ${(bt.baselineHitRate * 100).toFixed(1)}% → regelbok ${(bt.rulebookHitRate * 100).toFixed(1)}% (${bt.matches} testmatcher)`,
        };
      }
      default:
        return { step: id, ok: false, error: "Okänt steg" };
    }
  } catch (e) {
    return { step: id, ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function main(argv = process.argv.slice(2)) {
  const { steps, help, analyzeLimit } = parseArgs(argv);
  if (help || steps.length === 0) {
    printHelp();
    process.exit(help ? 0 : 1);
  }

  loadEnv();
  const supabase = createScriptSupabase();

  console.log("=== Fotbollspipeline ===");
  console.log(`Steg: ${steps.join(" → ")}\n`);

  const results: PipelineStepResult[] = [];
  for (const id of steps) {
    console.log(`▶ ${id}`);
    const r = await runStep(id, supabase, analyzeLimit);
    results.push(r);
    if (r.ok) console.log(`✓ ${r.detail}\n`);
    else console.error(`✗ ${r.error}\n`);
  }

  const fail = results.filter((r) => !r.ok);
  console.log("=== Klar ===");
  if (fail.length) {
    console.log(`Misslyckades: ${fail.map((f) => f.step).join(", ")}`);
    process.exit(1);
  }
}

const entry = process.argv[1]?.replace(/\\/g, "/") ?? "";
if (entry.endsWith("football-pipeline.ts")) {
  main().catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  });
}
