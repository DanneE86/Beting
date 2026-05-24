import type { SupabaseClient } from "@supabase/supabase-js";
import { eventsToArchiveRows } from "./archive-rows";
import { fetchScoreboardRange } from "./espn.api";
import { CALENDAR_YEAR_LEAGUES, seasonDateRange, seasonLabelForDate } from "./season-label";

export type BackfillOptions = {
  years?: number;
  delayMs?: number;
  skipIfCountAbove?: number;
  onSeasonStart?: (leagueId: string, season: string, fromYmd: string, toYmd: string) => void;
  onSeasonDone?: (leagueId: string, season: string, count: number) => void;
  onSeasonSkip?: (leagueId: string, season: string, existing: number) => void;
};

/** Backfill senaste N säsonger för en liga till archived_seasons. */
export async function backfillLeagueSeasons(
  supabase: SupabaseClient,
  leagueId: string,
  opts: BackfillOptions = {},
): Promise<number> {
  const years = opts.years ?? 3;
  const delayMs = opts.delayMs ?? 400;
  const skipIfCountAbove = opts.skipIfCountAbove ?? 50;
  const now = new Date();
  let totalInserted = 0;

  for (let i = 0; i < years; i++) {
    const anchorYear = now.getUTCFullYear() - i;
    const isCal = CALENDAR_YEAR_LEAGUES.has(leagueId);
    const anchor = new Date(Date.UTC(anchorYear, isCal ? 6 : 9, 1));
    const season = seasonLabelForDate(leagueId, anchor);

    const { count } = await supabase
      .from("archived_seasons")
      .select("*", { count: "exact", head: true })
      .eq("league_id", leagueId)
      .eq("season", season);

    if ((count ?? 0) > skipIfCountAbove) {
      opts.onSeasonSkip?.(leagueId, season, count ?? 0);
      continue;
    }

    const { fromYmd, toYmd } = seasonDateRange(leagueId, season, anchorYear);
    opts.onSeasonStart?.(leagueId, season, fromYmd, toYmd);

    const events = await fetchScoreboardRange(leagueId, fromYmd, toYmd, {
      delayMs,
      onWindowError: (winStart, winEnd, err) => {
        const msg = err instanceof Error ? err.message : String(err);
        console.warn(`  skip window ${winStart}-${winEnd}:`, msg);
      },
    });

    const rows = eventsToArchiveRows(events, leagueId, season);

    for (let j = 0; j < rows.length; j += 500) {
      const { error } = await supabase
        .from("archived_seasons")
        .upsert(rows.slice(j, j + 500), { onConflict: "league_id,season,event_id" });
      if (error) throw new Error(error.message);
    }

    opts.onSeasonDone?.(leagueId, season, rows.length);
    totalInserted += rows.length;
  }

  await supabase.from("league_season_state").upsert(
    {
      league_id: leagueId,
      current_season: seasonLabelForDate(leagueId, now),
      last_seen_round: 0,
      backfilled_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
    { onConflict: "league_id" },
  );

  return totalInserted;
}
