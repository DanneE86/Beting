import type { SupabaseClient } from "@supabase/supabase-js";
import { analyzeMatchOutcome } from "./football-match-analyzer";
import {
  buildRulebookFromAnalyses,
  optimizeRulebook,
  type FootballRule,
  type RulebookBacktest,
} from "./football-rulebook";
import type { ArchivedMatchRow } from "./league-training";
import { fetchArchivedRowsForLeague } from "./league-training";
import { LEAGUE_IDS } from "./leagues";
import { backfillLeagueSinceDate, FOOTBALL_SEASON_START } from "./football-since-sept-backfill";
import { enrichArchivedWithOpta } from "./football-opta-enrich";
import { espnGet, summaryUrl } from "./espn.api";
import { updateModelPrompt } from "./model-prompts.server";

const PAGE = 500;

let intelTableReady: boolean | null = null;
let rulebookTableReady: boolean | null = null;

function isMissingTable(error: { message?: string; code?: string } | null, table: string) {
  if (!error) return false;
  const msg = error.message ?? "";
  return error.code === "PGRST205" || msg.includes(table) || msg.includes("schema cache");
}

async function hasIntelTable(supabase: SupabaseClient): Promise<boolean> {
  if (intelTableReady != null) return intelTableReady;
  const { error } = await supabase.from("football_match_intel").select("id").limit(1);
  intelTableReady = !isMissingTable(error, "football_match_intel");
  return intelTableReady;
}

async function hasRulebookTable(supabase: SupabaseClient): Promise<boolean> {
  if (rulebookTableReady != null) return rulebookTableReady;
  const { error } = await supabase.from("football_rulebook").select("id").limit(1);
  rulebookTableReady = !isMissingTable(error, "football_rulebook");
  return rulebookTableReady;
}

export type PipelineStepResult = {
  step: string;
  ok: boolean;
  detail?: string;
  error?: string;
};

export async function runFootballIngest(
  supabase: SupabaseClient,
  leagueIds: string[] = [...LEAGUE_IDS],
): Promise<{ totalMatches: number }> {
  let total = 0;
  for (const lg of leagueIds) {
    const n = await backfillLeagueSinceDate(supabase, lg, {
      from: FOOTBALL_SEASON_START,
      delayMs: 350,
      onLeagueStart: (id) => console.log(`  [ingest] ${id}`),
      onLeagueDone: (id, count) => console.log(`  [ingest] ${id}: ${count} matcher`),
    });
    total += n;
  }
  return { totalMatches: total };
}

export async function runFootballOptaEnrich(
  supabase: SupabaseClient,
  opts?: { headed?: boolean; limitRows?: number },
) {
  return enrichArchivedWithOpta(supabase, {
    headed: opts?.headed ?? true,
    offsetHours: -7200,
    limitRows: opts?.limitRows,
  });
}

export async function fetchAllArchivedSinceSept(
  supabase: SupabaseClient,
): Promise<Array<ArchivedMatchRow & { league_id: string; season: string; event_id: string; home_name: string; away_name: string }>> {
  const rows: Array<
    ArchivedMatchRow & {
      league_id: string;
      season: string;
      event_id: string;
      home_name: string;
      away_name: string;
    }
  > = [];
  let from = 0;
  while (true) {
    const { data, error } = await supabase
      .from("archived_seasons")
      .select(
        "league_id, season, event_id, home_id, away_id, home_name, away_name, home_score, away_score, outcome, btts, event_date",
      )
      .gte("event_date", FOOTBALL_SEASON_START.toISOString())
      .not("outcome", "is", null)
      .order("event_date", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    if (!data?.length) break;
    rows.push(...(data as typeof rows));
    if (data.length < PAGE) break;
    from += PAGE;
  }
  return rows;
}

export async function runFootballAnalyze(
  supabase: SupabaseClient,
  opts?: { enrichEspnSummary?: boolean; limit?: number },
): Promise<{ analyzed: number; skipped: number }> {
  const all = await fetchAllArchivedSinceSept(supabase);
  const byLeague = new Map<string, typeof all>();
  for (const r of all) {
    const list = byLeague.get(r.league_id) ?? [];
    list.push(r);
    byLeague.set(r.league_id, list);
  }

  let analyzed = 0;
  let skipped = 0;
  const toProcess = opts?.limit ? all.slice(-opts.limit) : all;
  let useIntel = await hasIntelTable(supabase);
  const now = new Date().toISOString();
  const intelBatch: Record<string, unknown>[] = [];

  for (let i = 0; i < toProcess.length; i++) {
    const row = toProcess[i];
    const history = byLeague.get(row.league_id) ?? [];
    const analysis = analyzeMatchOutcome(row, history);

    if (useIntel) {
      intelBatch.push({
        league_id: row.league_id,
        season: row.season,
        event_id: row.event_id,
        event_date: row.event_date,
        home_id: row.home_id,
        away_id: row.away_id,
        home_name: row.home_name,
        away_name: row.away_name,
        home_score: row.home_score,
        away_score: row.away_score,
        outcome: row.outcome,
        btts: row.btts,
        analysis,
        rule_tags: analysis.tags,
        analyzed_at: now,
        updated_at: now,
      });
      if (intelBatch.length >= 200 || i === toProcess.length - 1) {
        const { error } = await supabase
          .from("football_match_intel")
          .upsert(intelBatch, { onConflict: "league_id,event_id" });
        if (error && isMissingTable(error, "football_match_intel")) {
          useIntel = false;
          intelTableReady = false;
          analyzed += intelBatch.length;
          intelBatch.length = 0;
        } else if (error) {
          skipped += intelBatch.length;
          intelBatch.length = 0;
        } else {
          analyzed += intelBatch.length;
          intelBatch.length = 0;
        }
      }
    } else {
      analyzed++;
    }

    if ((i + 1) % 1000 === 0) console.log(`  [analyze] ${i + 1}/${toProcess.length}`);
  }

  if (!useIntel && analyzed > 0) {
    console.log(
      "  [analyze] football_match_intel saknas — analyser körs i minnet; regelbok-steg sparar till opta_cache/model_learning_prompts",
    );
  }

  return { analyzed, skipped };
}

export async function runFootballRulebookTrain(
  supabase: SupabaseClient,
): Promise<{ rules: FootballRule[]; backtest: RulebookBacktest; version: number }> {
  const allRows: ArchivedMatchRow[] = [];
  for (const lg of LEAGUE_IDS) {
    const part = await fetchArchivedRowsForLeague(supabase, lg);
    const since = part.filter((r) => new Date(r.event_date) >= FOOTBALL_SEASON_START);
    allRows.push(...since);
  }

  let analyses: Array<{
    leagueId: string;
    analysis: ReturnType<typeof analyzeMatchOutcome>;
  }> = [];

  if (await hasIntelTable(supabase)) {
    const { data: intelRows } = await supabase
      .from("football_match_intel")
      .select("league_id, analysis")
      .gte("event_date", FOOTBALL_SEASON_START.toISOString())
      .limit(5000);
    analyses = (intelRows ?? []).map((r) => ({
      leagueId: r.league_id as string,
      analysis: r.analysis as ReturnType<typeof analyzeMatchOutcome>,
    }));
  } else {
    const archived = await fetchAllArchivedSinceSept(supabase);
    const byLeague = new Map<string, typeof archived>();
    for (const r of archived) {
      const list = byLeague.get(r.league_id) ?? [];
      list.push(r);
      byLeague.set(r.league_id, list);
    }
    for (const row of archived) {
      const history = byLeague.get(row.league_id) ?? [];
      analyses.push({
        leagueId: row.league_id,
        analysis: analyzeMatchOutcome(row, history),
      });
    }
  }

  const mined = buildRulebookFromAnalyses(analyses);
  const { rules, backtest } = optimizeRulebook(allRows, mined);

  let version = 1;
  const saveToRulebookTable = await hasRulebookTable(supabase);
  if (saveToRulebookTable) {
    await supabase.from("football_rulebook").update({ is_active: false }).eq("is_active", true);
    const { data: verRow } = await supabase
      .from("football_rulebook")
      .select("version")
      .order("version", { ascending: false })
      .limit(1)
      .maybeSingle();
    version = (verRow?.version ?? 0) + 1;
    const { error } = await supabase.from("football_rulebook").insert({
      version,
      is_active: true,
      rules,
      backtest,
      sample_matches: allRows.length,
      notes: `Tränad på ${allRows.length} matcher sedan ${FOOTBALL_SEASON_START.toISOString().slice(0, 10)}`,
    });
    if (error && isMissingTable(error, "football_rulebook")) {
      rulebookTableReady = false;
    } else if (error) {
      throw new Error(error.message);
    } else {
      return { rules, backtest, version };
    }
  }

  if (!saveToRulebookTable || rulebookTableReady === false) {
    const promptText = [
      `# Fotbollsregelbok v${version} (${allRows.length} matcher)`,
      `Backtest: baseline ${(backtest.baselineHitRate * 100).toFixed(1)}% → regelbok ${(backtest.rulebookHitRate * 100).toFixed(1)}%`,
      "",
      ...rules.map((r) => `- [${r.id}] ${r.description}`),
    ].join("\n");
    await updateModelPrompt({
      scope: "football-rulebook",
      promptText,
      lastSampleCount: allRows.length,
    });
    await supabase.from("opta_cache").upsert(
      {
        cache_key: "football_rulebook_latest",
        payload: { version, rules, backtest, sample_matches: allRows.length },
        fetched_at: new Date().toISOString(),
      },
      { onConflict: "cache_key" },
    );
  }

  return { rules, backtest, version };
}
