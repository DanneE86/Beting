/**
 * Dagens tips — tidsfönster, filtrering och merge med ESPN-scoreboard.
 */

import { LEAGUES } from "./fotmob.functions";
import { fetchScoreboardWindow } from "./espn.api";
import { parseEventRound, parseEventTeams } from "./espn.parsers";
import type { PredictionKeyRow } from "./predictions.repository";

export const TODAY_TIPS_GRACE_MS = 30 * 60_000;
export const TODAY_TIPS_HORIZON_MS = 24 * 3600_000;
export const TODAY_TIPS_RESOLVED_RETENTION_MS = 24 * 3600_000;

export type TodayTipsWindow = {
  windowStart: Date;
  windowEnd: Date;
  resolvedSince: Date;
};

export type TodayTipsRow = {
  event_date?: string | null;
  actual_outcome?: string | null;
  resolved_at?: string | null;
};

export type ScoreboardCandidate = {
  leagueId: string;
  homeId: string;
  awayId: string;
  homeName: string;
  awayName: string;
  round: number | null;
  utcTime: string;
  eventId?: string | null;
};

export function getTodayTipsWindow(now = new Date()): TodayTipsWindow {
  const ts = now.getTime();
  return {
    windowStart: new Date(ts - TODAY_TIPS_GRACE_MS),
    windowEnd: new Date(ts + TODAY_TIPS_HORIZON_MS),
    resolvedSince: new Date(ts - TODAY_TIPS_RESOLVED_RETENTION_MS),
  };
}

export function isWithinTodayTipsKickoff(
  eventDate: string | null | undefined,
  window: TodayTipsWindow,
): boolean {
  if (!eventDate) return false;
  const t = new Date(eventDate).getTime();
  if (!isFinite(t)) return false;
  return t >= window.windowStart.getTime() && t <= window.windowEnd.getTime();
}

/** Ska raden visas på Dagens tips? */
export function isTodayTipsRow(
  row: TodayTipsRow,
  window: TodayTipsWindow,
  now = new Date(),
): boolean {
  if (!row.actual_outcome) {
    if (!row.event_date) return true;
    const t = new Date(row.event_date).getTime();
    if (!isFinite(t)) return true;
    // Orättat: kommande inom 24h, pågående (grace) eller väntar facit
    if (t <= window.windowEnd.getTime()) return true;
    return false;
  }
  if (!row.resolved_at) return false;
  const resolvedAt = new Date(row.resolved_at).getTime();
  return resolvedAt >= window.resolvedSince.getTime();
}

export function filterTodayTipsRows<T extends TodayTipsRow>(
  rows: T[],
  window: TodayTipsWindow,
  now = new Date(),
): T[] {
  return rows.filter((r) => isTodayTipsRow(r, window, now));
}

export function scoreboardMatchKey(c: ScoreboardCandidate): string {
  return `${c.leagueId}|${c.homeId}|${c.awayId}`;
}

export function predictionRowMatchKey(row: PredictionKeyRow): string {
  if (row.event_id) return row.event_id;
  const home = row.home_id ?? row.home_name ?? "";
  const away = row.away_id ?? row.away_name ?? "";
  return `${row.league_id}|${home}|${away}`;
}

/** Hämta alla matcher från ESPN inom Dagens tips-fönstret. */
export async function fetchTodayScoreboardCandidates(
  now = new Date(),
): Promise<ScoreboardCandidate[]> {
  const window = getTodayTipsWindow(now);
  const fromMs = window.windowStart.getTime() - 86400_000;
  const toMs = window.windowEnd.getTime() + 86400_000;
  const candidates: ScoreboardCandidate[] = [];

  await Promise.all(
    LEAGUES.map(async (lg) => {
      try {
        const events = await fetchScoreboardWindow(lg.id, fromMs, toMs);
        for (const e of events) {
          const t = new Date(e.date).getTime();
          if (!isFinite(t)) continue;
          if (t < window.windowStart.getTime() || t > window.windowEnd.getTime()) continue;
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
            eventId: e.id != null ? String(e.id) : null,
          });
        }
      } catch (err) {
        console.error(`today-tips scoreboard fetch failed for ${lg.id}`, err);
      }
    }),
  );

  candidates.sort(
    (a, b) => new Date(a.utcTime).getTime() - new Date(b.utcTime).getTime(),
  );
  return candidates;
}

export type TodayTipsPlaceholderRow = {
  id: string;
  league_id: string;
  home_id: string;
  away_id: string;
  home_name: string;
  away_name: string;
  event_id: string | null;
  event_date: string;
  round: number | null;
  predicted_outcome: null;
  predicted_score: null;
  confidence: null;
  actual_outcome: null;
  actual_home_score: null;
  actual_away_score: null;
  resolved_at: null;
  created_at: string;
  btts_call: null;
  btts_reason: null;
  betting_tip: null;
  key_factors: null;
  home_win_pct: null;
  draw_pct: null;
  away_win_pct: null;
  postmortem: null;
};

export function scoreboardToPlaceholder(c: ScoreboardCandidate): TodayTipsPlaceholderRow {
  return {
    id: `pending-${c.leagueId}-${c.homeId}-${c.awayId}-${c.utcTime}`,
    league_id: c.leagueId,
    home_id: c.homeId,
    away_id: c.awayId,
    home_name: c.homeName,
    away_name: c.awayName,
    event_id: c.eventId ?? null,
    event_date: c.utcTime,
    round: c.round,
    predicted_outcome: null,
    predicted_score: null,
    confidence: null,
    actual_outcome: null,
    actual_home_score: null,
    actual_away_score: null,
    resolved_at: null,
    created_at: new Date().toISOString(),
    btts_call: null,
    btts_reason: null,
    betting_tip: null,
    key_factors: null,
    home_win_pct: null,
    draw_pct: null,
    away_win_pct: null,
    postmortem: null,
  };
}

/** Lägg till scoreboard-matcher som saknar sparad prognos. */
export function mergeTodayTipsWithScoreboard<
  T extends PredictionKeyRow & TodayTipsRow,
>(
  predictions: T[],
  candidates: ScoreboardCandidate[],
): (T | TodayTipsPlaceholderRow)[] {
  const seen = new Set(predictions.map((r) => predictionRowMatchKey(r)));
  const extras: TodayTipsPlaceholderRow[] = [];
  for (const c of candidates) {
    const key = scoreboardMatchKey(c);
    if (seen.has(key)) continue;
    if (c.eventId && seen.has(c.eventId)) continue;
    seen.add(key);
    extras.push(scoreboardToPlaceholder(c));
  }
  const merged = [...predictions, ...extras];
  merged.sort(
    (a, b) =>
      new Date(a.event_date ?? a.created_at ?? 0).getTime() -
      new Date(b.event_date ?? b.created_at ?? 0).getTime(),
  );
  return merged;
}

/** Endast ESPN-scoreboard → placeholder-rader för Dagens tips. */
export function todayTipsFromScoreboardOnly(
  candidates: ScoreboardCandidate[],
): TodayTipsPlaceholderRow[] {
  return candidates.map(scoreboardToPlaceholder);
}
