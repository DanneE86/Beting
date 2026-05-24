import { createServerFn } from "@tanstack/react-start";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  getCalibration,
  resolvePendingPredictions,
  type LeagueCalibration,
} from "./learning.server";
import { LEAGUES } from "./fotmob.functions";
import { generateMatchPrediction } from "./predict.functions";
import { PREDICTION_MODEL_VERSION } from "./prediction-meta";
import {
  dedupePredictions,
  PREDICTION_SELECT_BASE,
  PREDICTION_SELECT_TODAY,
} from "./predictions.repository";
import {
  fetchTodayScoreboardCandidates,
  filterTodayTipsRows,
  getTodayTipsWindow,
  mergeTodayTipsWithScoreboard,
  todayTipsFromScoreboardOnly,
  TODAY_TIPS_GRACE_MS,
  TODAY_TIPS_HORIZON_MS,
} from "./today-tips";
import { isSupabaseAdminConfigured, withSupabaseAdmin } from "./supabase-admin";
import {
  confidenceRank,
  emptyOutcomeBuckets,
  tallyConfidence,
  tallyOutcome,
} from "./prediction-analytics";
import { fetchScoreboardWindow } from "./espn.api";
import { parseEventRound, parseEventTeams } from "./espn.parsers";

type LeagueId = (typeof LEAGUES)[number]["id"];

// Hämtar lärdomar för ALLA ligor — senaste tipsen blandade, och kalibrering per liga.
export const getLeagueLearning = createServerFn({ method: "GET" })
  .handler(async () => {
    const leagueIds = LEAGUES.map((l) => l.id);
    const calibrations: Record<string, LeagueCalibration> = {};
    await Promise.all(
      leagueIds.map(async (id) => {
        calibrations[id] = await getCalibration(id);
      }),
    );

    const { data: rows } = await supabaseAdmin
      .from("predictions")
      .select(PREDICTION_SELECT_BASE)
      .in("league_id", leagueIds)
      .order("created_at", { ascending: false })
      .limit(2000);

    const dedup = dedupePredictions(rows ?? []);
    const recent = dedup.slice(0, 30);

    // Per-liga analys: vad gick rätt, vad gick fel
    type Row = (typeof dedup)[number];
    type Analysis = {
      leagueId: string;
      leagueName: string;
      total: number;
      resolved: number;
      hits: number;
      misses: number;
      hitRate: number;
      byOutcome: { H: { n: number; hits: number }; D: { n: number; hits: number }; A: { n: number; hits: number } };
      byConfidence: Record<string, { n: number; hits: number }>;
      worstMisses: Row[]; // hög conf men fel
      bestHits: Row[]; // hög conf och rätt
      allMatches: Row[];
    };
    const perLeague: Analysis[] = LEAGUES.map((lg) => {
      const items = dedup.filter((r) => r.league_id === lg.id);
      const resolved = items.filter((r) => r.actual_outcome != null);
      const hits = resolved.filter((r) => r.predicted_outcome === r.actual_outcome);
      const misses = resolved.filter((r) => r.predicted_outcome !== r.actual_outcome);
      const byOutcome = emptyOutcomeBuckets();
      const byConfidence: Record<string, { n: number; hits: number }> = {};
      for (const r of resolved) {
        const ok = r.predicted_outcome === r.actual_outcome;
        tallyOutcome(byOutcome, r.predicted_outcome, ok);
        tallyConfidence(byConfidence, r.confidence, ok);
      }
      const worstMisses = [...misses]
        .sort((a, b) => confidenceRank(b.confidence) - confidenceRank(a.confidence))
        .slice(0, 5);
      const bestHits = [...hits]
        .filter((r) => r.confidence === "hög" || r.confidence === "medel")
        .slice(0, 5);
      return {
        leagueId: lg.id,
        leagueName: lg.name,
        total: items.length,
        resolved: resolved.length,
        hits: hits.length,
        misses: misses.length,
        hitRate: resolved.length ? hits.length / resolved.length : 0,
        byOutcome,
        byConfidence,
        worstMisses,
        bestHits,
        allMatches: items.slice(0, 50),
      };
    });

    return { calibrations, recent, perLeague };
  });



// Dagens tips — alla orättade tips (matcher som spelats men inte rättats än)
// + alla kommande matcher inom 24h. Matcher ligger kvar här tills användaren
// klickar "Hämta facit" på Dagens tips-fliken.
export const getTodayTips = createServerFn({ method: "GET" })
  .handler(async () => {
    const leagueIds = LEAGUES.map((l) => l.id);
    const now = new Date();
    const window = getTodayTipsWindow(now);
    const windowEndIso = window.windowEnd.toISOString();
    const supabaseAvailable = isSupabaseAdminConfigured();

    const scoreboardCandidates = await fetchTodayScoreboardCandidates(now);

    const dbRows =
      (await withSupabaseAdmin(async (db) => {
        const { data, error } = await db
          .from("predictions")
          .select(PREDICTION_SELECT_TODAY)
          .in("league_id", leagueIds)
          .is("hidden_from_today_at", null)
          .or(`event_date.is.null,event_date.lt.${windowEndIso}`)
          .order("event_date", { ascending: true })
          .limit(2000);
        if (error) throw error;
        return data ?? [];
      })) ?? [];

    const filtered = filterTodayTipsRows(dbRows, window, now);
    const sorted = [...filtered].sort(
      (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
    );
    const deduped = dedupePredictions(sorted);
    const items =
      supabaseAvailable || deduped.length > 0
        ? mergeTodayTipsWithScoreboard(deduped, scoreboardCandidates)
        : todayTipsFromScoreboardOnly(scoreboardCandidates);

    const sthlmYmd = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Europe/Stockholm",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(now);
    return {
      items,
      dateLabel: `Tips · ${sthlmYmd}`,
      scoreboardCount: scoreboardCandidates.length,
      supabaseAvailable,
    };
  });

// Flytta alla rättade tips från "Dagens tips" till "Historik" manuellt.
export const hideResolvedFromToday = createServerFn({ method: "POST" })
  .handler(async () => {
    const { data, error } = await supabaseAdmin
      .from("predictions")
      .update({ hidden_from_today_at: new Date().toISOString() })
      .not("actual_outcome", "is", null)
      .is("hidden_from_today_at", null)
      .select("id");
    if (error) throw new Error(error.message);
    return { moved: data?.length ?? 0 };
  });





// Historik per liga och omgång — alla avgjorda tips (inkl. dagens om de hunnit avgöras).
export const getHistory = createServerFn({ method: "GET" })
  .handler(async () => {
    const leagueIds = LEAGUES.map((l) => l.id);
    const { data: rows } = await supabaseAdmin
      .from("predictions")
      .select(PREDICTION_SELECT_BASE)
      .in("league_id", leagueIds)
      .not("actual_outcome", "is", null)
      .order("created_at", { ascending: false })
      .limit(2000);

    const resolved = dedupePredictions(rows ?? []);

    type Item = (typeof resolved)[number];
    type RoundGroup = {
      key: string; // round nummer eller datum-fallback
      label: string;
      total: number;
      hits: number;
      byConfidence: Record<string, { n: number; hits: number }>;
      items: Item[];
    };
    type LeagueGroup = {
      leagueId: string;
      leagueName: string;
      total: number;
      hits: number;
      byConfidence: Record<string, { n: number; hits: number }>;
      rounds: RoundGroup[];
    };

    const out: LeagueGroup[] = LEAGUES.map((lg) => ({
      leagueId: lg.id,
      leagueName: lg.name,
      total: 0,
      hits: 0,
      byConfidence: {},
      rounds: [],
    }));

    const roundMap = new Map<string, RoundGroup>(); // nyckel: leagueId|round/datum
    for (const r of resolved) {
      const lg = out.find((l) => l.leagueId === r.league_id);
      if (!lg) continue;
      const ok = r.predicted_outcome === r.actual_outcome;
      lg.total++;
      if (ok) lg.hits++;
      const conf = r.confidence ?? "okänd";
      lg.byConfidence[conf] ??= { n: 0, hits: 0 };
      lg.byConfidence[conf].n++;
      if (ok) lg.byConfidence[conf].hits++;

      const rkey =
        r.round != null
          ? `${r.league_id}|round-${r.round}`
          : `${r.league_id}|date-${
              r.event_date
                ? new Date(r.event_date).toISOString().slice(0, 10)
                : new Date(r.created_at).toISOString().slice(0, 10)
            }`;
      let rg = roundMap.get(rkey);
      if (!rg) {
        rg = {
          key: rkey,
          label:
            r.round != null
              ? `Omgång ${r.round}`
              : `Omgång (okänd) · ${
                  r.event_date
                    ? new Date(r.event_date).toLocaleDateString("sv-SE")
                    : new Date(r.created_at).toLocaleDateString("sv-SE")
                }`,
          total: 0,
          hits: 0,
          byConfidence: {},
          items: [],
        };
        roundMap.set(rkey, rg);
        lg.rounds.push(rg);
      }
      rg.total++;
      if (ok) rg.hits++;
      rg.byConfidence[conf] ??= { n: 0, hits: 0 };
      rg.byConfidence[conf].n++;
      if (ok) rg.byConfidence[conf].hits++;
      rg.items.push(r);
    }

    const itemTs = (r: any) =>
      new Date(r.event_date ?? r.resolved_at ?? r.created_at).getTime();
    for (const lg of out) {
      lg.rounds.sort((a, b) => {
        const ra = a.key.includes("round-")
          ? Number(a.key.split("round-")[1])
          : -1;
        const rb = b.key.includes("round-")
          ? Number(b.key.split("round-")[1])
          : -1;
        if (rb !== ra) return rb - ra;
        // Fallback: nyaste matchen i omgången först
        const ta = Math.max(...a.items.map(itemTs));
        const tb = Math.max(...b.items.map(itemTs));
        return tb - ta;
      });
      // Inom varje omgång: senaste matchen högst upp
      for (const rd of lg.rounds) {
        rd.items.sort((a, b) => itemTs(b) - itemTs(a));
      }
    }

    return { leagues: out };
  });

export const resolveResults = createServerFn({ method: "POST" })
  .handler(async () => {
    const result = await resolvePendingPredictions(100);
    // Försök auto-uppdatera ligaspecifika träningsprompter (tröskel = 20 nya resolverade).
    let promptUpdate: { updated: number; skipped: number } = { updated: 0, skipped: 0 };
    try {
      const { analyzeAndUpdateLeaguePrompts } = await import("./prompts.functions");
      const r = await analyzeAndUpdateLeaguePrompts();
      promptUpdate = { updated: r.updated, skipped: r.skipped };
    } catch (e) {
      console.error("analyzeAndUpdateLeaguePrompts failed", e);
    }
    return { ...result, promptsUpdated: promptUpdate.updated };
  });

// Bulk-generera AI-prognoser för alla matcher som spelas inom nästa 24h
// och som ännu inte har ett tips i predictions-tabellen.
export const generateTodayPredictions = createServerFn({ method: "POST" })
  .handler(async () => {
    const now = Date.now();
    const cutoffStart = now - TODAY_TIPS_GRACE_MS;
    const cutoffEnd = now + TODAY_TIPS_HORIZON_MS;

    type Candidate = {
      leagueId: string;
      homeId: string;
      awayId: string;
      homeName: string;
      awayName: string;
      round: number | null;
      utcTime: string;
    };
    const candidates: Candidate[] = [];

    await Promise.all(
      LEAGUES.map(async (lg) => {
        try {
          const events = await fetchScoreboardWindow(lg.id, cutoffStart - 86400_000, cutoffEnd + 86400_000);
          for (const e of events) {
            const t = new Date(e.date).getTime();
            if (!isFinite(t) || t < cutoffStart || t > cutoffEnd) continue;
            const teams = parseEventTeams(e);
            if (!teams) continue;
            candidates.push({
              leagueId: lg.id,
              homeId: teams.homeId,
              awayId: teams.awayId,
              homeName: teams.homeName,
              awayName: teams.awayName,
              round: parseEventRound(e),
              utcTime: e.date,
            });
          }
        } catch (err) {
          console.error(`scoreboard fetch failed for ${lg.id}`, err);
        }
      }),
    );

    const fromIso = new Date(cutoffStart - 3600_000).toISOString();
    const toIso = new Date(cutoffEnd + 3600_000).toISOString();

    // Hämta föråldrade öppna tips (gammal modellversion) inom samma fönster
    const { data: staleOpen } = await supabaseAdmin
      .from("predictions")
      .select("league_id, home_id, away_id, home_name, away_name, round, event_date, model_version")
      .in("league_id", LEAGUES.map((l) => l.id))
      .is("actual_outcome", null)
      .is("hidden_from_today_at", null)
      .gte("event_date", fromIso)
      .lt("event_date", toIso);

    const candidateKeys = new Set(
      candidates.map((c) => `${c.leagueId}|${c.homeId}|${c.awayId}`),
    );
    for (const r of staleOpen ?? []) {
      const key = `${r.league_id}|${r.home_id}|${r.away_id}`;
      if (candidateKeys.has(key)) continue;
      const mv = r.model_version ?? 1;
      if (mv >= PREDICTION_MODEL_VERSION) continue;
      candidates.push({
        leagueId: r.league_id,
        homeId: r.home_id,
        awayId: r.away_id,
        homeName: r.home_name,
        awayName: r.away_name,
        round: r.round ?? null,
        utcTime: r.event_date ?? new Date().toISOString(),
      });
      candidateKeys.add(key);
    }

    // Alla kandidater — upsert uppdaterar befintliga öppna tips (ingen skip p.g.a. gammal BTTS)
    const todo = candidates;

    // Kör 3 parallella prognoser åt gången för att skona AI-gateway.
    let generated = 0;
    let failed = 0;
    const concurrency = 3;
    let cursor = 0;
    async function worker() {
      while (cursor < todo.length) {
        const i = cursor++;
        const c = todo[i];
        try {
          await generateMatchPrediction({
            leagueId: c.leagueId,
            homeId: c.homeId,
            awayId: c.awayId,
            homeName: c.homeName,
            awayName: c.awayName,
            round: c.round,
          });
          generated++;
        } catch (err) {
          failed++;
          console.error(
            `generateMatchPrediction failed ${c.leagueId} ${c.homeName} vs ${c.awayName}`,
            err,
          );
        }
      }
    }
    await Promise.all(
      Array.from({ length: Math.min(concurrency, todo.length) }, () => worker()),
    );

    return {
      total: candidates.length,
      skipped: 0,
      generated,
      failed,
    };
  });
