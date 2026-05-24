import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { LEAGUES } from "@/lib/leagues";
import { fetchScoreboardRange } from "@/lib/espn.api";
import { parseEventTeams } from "@/lib/espn.parsers";
import { outcomeFromScore } from "@/lib/match-outcome";
import {
  CALENDAR_YEAR_LEAGUES,
  currentSeasonLabel,
  seasonLabelForDate,
} from "@/lib/season-label";

export { currentSeasonLabel, seasonLabelForDate };

function outcomeOf(h: number | null, a: number | null): string | null {
  return outcomeFromScore(h, a);
}

// Backfill: hämta de senaste N säsongerna för en liga och lagra färdiga matcher i archived_seasons
export const backfillLeagueHistory = createServerFn({ method: "POST" })
  .inputValidator((d) =>
    z.object({ leagueId: z.string().min(1), years: z.number().int().min(1).max(5).default(3) }).parse(d),
  )
  .handler(async ({ data }) => {
    const now = new Date();
    const results: { season: string; inserted: number; skipped: number }[] = [];

    for (let i = 0; i < data.years; i++) {
      // Anchor-datum för varje säsong: oktober år (mitten av Europa-säsong), juli för kalenderår-ligor
      const anchorYear = now.getUTCFullYear() - i;
      const isCal = CALENDAR_YEAR_LEAGUES.has(data.leagueId);
      const anchor = new Date(Date.UTC(anchorYear, isCal ? 6 : 9, 1));
      const season = seasonLabelForDate(data.leagueId, anchor);

      // Hoppa om vi redan har data för den här säsongen
      const { count: existing } = await supabaseAdmin
        .from("archived_seasons")
        .select("*", { count: "exact", head: true })
        .eq("league_id", data.leagueId)
        .eq("season", season);
      if ((existing ?? 0) > 50) {
        results.push({ season, inserted: 0, skipped: existing ?? 0 });
        continue;
      }

      // Datumintervall: för europeiska ligor jul→jun, för kalenderår jan→dec
      let fromY: number, fromM: number, toY: number, toM: number;
      if (isCal) {
        fromY = anchorYear; fromM = 1; toY = anchorYear; toM = 12;
      } else {
        const [a, b] = season.split("-").map(Number);
        fromY = a; fromM = 7; toY = b; toM = 6;
      }
      const fromYmd = `${fromY}${String(fromM).padStart(2, "0")}01`;
      const lastDay = new Date(Date.UTC(toY, toM, 0)).getUTCDate();
      const toYmd = `${toY}${String(toM).padStart(2, "0")}${String(lastDay).padStart(2, "0")}`;

      const events = await fetchScoreboardRange(data.leagueId, fromYmd, toYmd);
      const rows = events
        .map((e: any) => {
          if (e.status?.type?.state !== "post") return null;
          const teams = parseEventTeams(e);
          if (!teams) return null;
          const hs = teams.homeScore;
          const as = teams.awayScore;
          return {
            league_id: data.leagueId,
            season,
            event_id: String(e.id),
            event_date: e.date,
            home_id: teams.homeId,
            away_id: teams.awayId,
            home_name: teams.homeName,
            away_name: teams.awayName,
            home_score: hs,
            away_score: as,
            outcome: outcomeOf(hs, as),
            btts: hs != null && as != null ? hs > 0 && as > 0 : null,
            round: parseEventRound(e),
            raw: null,
          };
        })
        .filter(Boolean) as any[];

      if (rows.length > 0) {
        // Upsert i batchar om 500
        for (let j = 0; j < rows.length; j += 500) {
          await supabaseAdmin
            .from("archived_seasons")
            .upsert(rows.slice(j, j + 500), { onConflict: "league_id,season,event_id" });
        }
      }
      results.push({ season, inserted: rows.length, skipped: 0 });
    }

    await supabaseAdmin
      .from("league_season_state")
      .upsert(
        {
          league_id: data.leagueId,
          current_season: currentSeasonLabel(data.leagueId),
          last_seen_round: 0,
          backfilled_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
        { onConflict: "league_id" },
      );

    return { leagueId: data.leagueId, results };
  });

// Backfill alla ligor — körs sekventiellt för att inte överbelasta ESPN
export const backfillAllLeagues = createServerFn({ method: "POST" })
  .inputValidator((d) => z.object({ years: z.number().int().min(1).max(5).default(3) }).parse(d))
  .handler(async ({ data }) => {
    const out: { leagueId: string; ok: boolean; error?: string }[] = [];
    for (const lg of LEAGUES) {
      try {
        // Skippa om redan backfillad
        const { data: state } = await supabaseAdmin
          .from("league_season_state")
          .select("backfilled_at")
          .eq("league_id", lg.id)
          .maybeSingle();
        if (state?.backfilled_at) {
          out.push({ leagueId: lg.id, ok: true });
          continue;
        }
        await backfillLeagueHistory({ data: { leagueId: lg.id, years: data.years } });
        out.push({ leagueId: lg.id, ok: true });
      } catch (e: any) {
        out.push({ leagueId: lg.id, ok: false, error: e?.message ?? "unknown" });
      }
    }
    return { results: out };
  });

// Detektera säsongsväxling och flytta gamla rättade predictions till archived_predictions
export const archiveSeasonIfChanged = createServerFn({ method: "POST" })
  .inputValidator((d) => z.object({ leagueId: z.string().min(1) }).parse(d))
  .handler(async ({ data }) => {
    const currentSeason = currentSeasonLabel(data.leagueId);
    const { data: state } = await supabaseAdmin
      .from("league_season_state")
      .select("current_season")
      .eq("league_id", data.leagueId)
      .maybeSingle();

    const prevSeason = state?.current_season;
    if (!prevSeason || prevSeason === currentSeason) {
      // Ingen säsongsväxling
      await supabaseAdmin.from("league_season_state").upsert(
        {
          league_id: data.leagueId,
          current_season: currentSeason,
          last_seen_round: 0,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "league_id" },
      );
      return { archived: 0, newSeason: false };
    }

    // Flytta alla rättade predictions som hör till föregående säsong
    const { data: oldRows } = await supabaseAdmin
      .from("predictions")
      .select("*")
      .eq("league_id", data.leagueId)
      .not("actual_outcome", "is", null);

    let archived = 0;
    if (oldRows && oldRows.length > 0) {
      const toArchive = oldRows.map((r: any) => ({
        original_id: r.id,
        league_id: r.league_id,
        season: prevSeason,
        home_id: r.home_id,
        away_id: r.away_id,
        home_name: r.home_name,
        away_name: r.away_name,
        event_id: r.event_id,
        event_date: r.event_date,
        home_win_pct: r.home_win_pct,
        draw_pct: r.draw_pct,
        away_win_pct: r.away_win_pct,
        predicted_score: r.predicted_score,
        predicted_outcome: r.predicted_outcome,
        confidence: r.confidence,
        betting_tip: r.betting_tip,
        key_factors: r.key_factors,
        actual_home_score: r.actual_home_score,
        actual_away_score: r.actual_away_score,
        actual_outcome: r.actual_outcome,
        brier_score: r.brier_score,
        postmortem: r.postmortem,
        round: r.round,
        resolved_at: r.resolved_at,
        created_at: r.created_at,
      }));
      for (let j = 0; j < toArchive.length; j += 500) {
        await supabaseAdmin.from("archived_predictions").insert(toArchive.slice(j, j + 500));
      }
      const ids = oldRows.map((r: any) => r.id);
      await supabaseAdmin.from("predictions").delete().in("id", ids);
      archived = oldRows.length;
    }

    await supabaseAdmin.from("league_season_state").upsert(
      {
        league_id: data.leagueId,
        current_season: currentSeason,
        last_seen_round: 0,
        season_started_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
      { onConflict: "league_id" },
    );

    return { archived, newSeason: true, prevSeason, currentSeason };
  });

// Status för alla ligor — används av UI för "Ny säsong"-badge
export const getAllLeagueSeasonStatus = createServerFn({ method: "GET" }).handler(async () => {
  const { data: states } = await supabaseAdmin.from("league_season_state").select("*");
  const { data: rounds } = await supabaseAdmin
    .from("predictions")
    .select("league_id, round, event_date")
    .not("round", "is", null);

  const maxRoundByLeague = new Map<string, number>();
  for (const r of rounds ?? []) {
    const prev = maxRoundByLeague.get(r.league_id) ?? 0;
    if ((r.round ?? 0) > prev) maxRoundByLeague.set(r.league_id, r.round ?? 0);
  }

  return LEAGUES.map((lg) => {
    const state = states?.find((s: any) => s.league_id === lg.id);
    const currentSeason = currentSeasonLabel(lg.id);
    const maxRound = maxRoundByLeague.get(lg.id) ?? 0;
    const isNewSeason = !!state && state.current_season === currentSeason && maxRound > 0 && maxRound <= 4;
    return {
      leagueId: lg.id,
      currentSeason,
      backfilled: !!state?.backfilled_at,
      isNewSeason,
      maxRound,
    };
  });
});
