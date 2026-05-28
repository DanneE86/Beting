import type { SupabaseClient } from "@supabase/supabase-js";
import { findOptaMatch, normTeam } from "./opta.utils";
import type { OptaMatch } from "./opta.scraper";
import { fetchOptaScoresHistory } from "./opta.scraper";

export type OptaEnrichResult = {
  optaMatchesFetched: number;
  archivedMatched: number;
  intelUpdated: number;
};

/** Hämtar Opta via Playwright och kopplar till arkiverade matcher (namn + datum). */
export async function enrichArchivedWithOpta(
  supabase: SupabaseClient,
  opts?: { offsetHours?: number; headed?: boolean; limitRows?: number },
): Promise<OptaEnrichResult> {
  const headed = opts?.headed ?? true;

  const live = await fetchOptaScoresHistory({ headed });
  const optaByKey = new Map<string, OptaMatch>();
  for (const m of live.matches) {
    if (m.status !== "played" && m.status !== "post") continue;
    const key = `${normTeam(m.homeName)}|${normTeam(m.awayName)}|${dayKey(m.date)}`;
    optaByKey.set(key, m);
  }

  let q = supabase
    .from("archived_seasons")
    .select(
      "league_id, season, event_id, event_date, home_id, away_id, home_name, away_name, home_score, away_score, outcome, btts",
    )
    .gte("event_date", "2025-09-01")
    .not("outcome", "is", null)
    .order("event_date", { ascending: false });

  if (opts?.limitRows) q = q.limit(opts.limitRows);

  const { data: archived, error } = await q;
  if (error) throw new Error(error.message);

  let matched = 0;
  let intelUpdated = 0;

  for (const row of archived ?? []) {
    const d = row.event_date ? new Date(row.event_date) : null;
    const key = `${normTeam(row.home_name)}|${normTeam(row.away_name)}|${d ? dayKey(Math.floor(d.getTime() / 1000)) : ""}`;
    const opta = optaByKey.get(key);
    if (!opta) continue;
    matched++;

    const payload = {
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
      opta_payload: opta,
      updated_at: new Date().toISOString(),
    };

    const { error: upErr } = await supabase.from("football_match_intel").upsert(payload, {
      onConflict: "league_id,event_id",
    });
    if (!upErr) intelUpdated++;

    await supabase
      .from("archived_seasons")
      .update({ raw: { opta_id: opta.id, opta_status: opta.status, opta_league: opta.leagueName } })
      .eq("league_id", row.league_id)
      .eq("event_id", row.event_id);
  }

  await supabase.from("opta_cache").upsert(
    {
      cache_key: "livescores_history_chunked",
      payload: live,
      fetched_at: live.fetchedAt,
    },
    { onConflict: "cache_key" },
  );

  return {
    optaMatchesFetched: live.matches.length,
    archivedMatched: matched,
    intelUpdated,
  };
}

function dayKey(unixSec: number): string {
  const d = new Date(unixSec * 1000);
  return d.toISOString().slice(0, 10);
}

export { findOptaMatch };
