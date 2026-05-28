import type { SupabaseClient } from "@supabase/supabase-js";
import { eventsToArchiveRows } from "./archive-rows";
import { espnYmd, fetchScoreboardRange } from "./espn.api";
import { seasonLabelForDate } from "./season-label";

export const FOOTBALL_SEASON_START = new Date("2025-09-01T00:00:00Z");

export type SinceSeptBackfillOpts = {
  from?: Date;
  to?: Date;
  delayMs?: number;
  onLeagueStart?: (leagueId: string) => void;
  onLeagueDone?: (leagueId: string, count: number) => void;
};

/** Hämtar alla spelade matcher från datum (default sept 2025) till idag för en liga. */
export async function backfillLeagueSinceDate(
  supabase: SupabaseClient,
  leagueId: string,
  opts: SinceSeptBackfillOpts = {},
): Promise<number> {
  const from = opts.from ?? FOOTBALL_SEASON_START;
  const to = opts.to ?? new Date();
  const fromYmd = espnYmd(from);
  const toYmd = espnYmd(to);
  const delayMs = opts.delayMs ?? 400;

  opts.onLeagueStart?.(leagueId);

  const events = await fetchScoreboardRange(leagueId, fromYmd, toYmd, {
    delayMs,
    onWindowError: (winStart, winEnd, err) => {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`  [${leagueId}] skip ${winStart}-${winEnd}: ${msg}`);
    },
  });

  const bySeason = new Map<string, ReturnType<typeof eventsToArchiveRows>>();
  for (const e of events) {
    const raw = e as { date?: string };
    const d = raw.date ? new Date(raw.date) : from;
    const season = seasonLabelForDate(leagueId, d);
    const rows = bySeason.get(season) ?? [];
    rows.push(...eventsToArchiveRows([e], leagueId, season));
    bySeason.set(season, rows);
  }

  let total = 0;
  for (const [season, rows] of bySeason) {
    const deduped = dedupeRows(rows);
    for (let j = 0; j < deduped.length; j += 500) {
      const { error } = await supabase
        .from("archived_seasons")
        .upsert(deduped.slice(j, j + 500), { onConflict: "league_id,season,event_id" });
      if (error) throw new Error(`${leagueId}/${season}: ${error.message}`);
    }
    total += deduped.length;
  }

  opts.onLeagueDone?.(leagueId, total);
  return total;
}

function dedupeRows<T extends { event_id: string }>(rows: T[]): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const r of rows) {
    if (seen.has(r.event_id)) continue;
    seen.add(r.event_id);
    out.push(r);
  }
  return out;
}
