export const PREDICTION_SELECT_BASE =
  "id, league_id, event_id, event_date, home_id, away_id, home_name, away_name, predicted_outcome, predicted_score, home_win_pct, draw_pct, away_win_pct, confidence, actual_outcome, actual_home_score, actual_away_score, resolved_at, created_at, round, postmortem, btts_call, btts_reason";

export const PREDICTION_SELECT_TODAY =
  `${PREDICTION_SELECT_BASE}, betting_tip, key_factors, model_version, hidden_from_today_at`;

export type PredictionKeyRow = {
  event_id?: string | null;
  league_id: string;
  home_id?: string | null;
  away_id?: string | null;
  home_name?: string;
  away_name?: string;
  event_date?: string | null;
  created_at?: string;
};

/** Unik nyckel per match — event_id prioriteras, annars liga+lag(+datum). */
export function predictionMatchKey(
  row: PredictionKeyRow,
  opts?: { includeDate?: boolean },
): string {
  if (row.event_id) return row.event_id;
  const home = row.home_id ?? row.home_name ?? "";
  const away = row.away_id ?? row.away_name ?? "";
  const base = `${row.league_id}-${home}-${away}`;
  if (opts?.includeDate === false) return base;
  const date = row.event_date
    ? new Date(row.event_date).toISOString().slice(0, 10)
    : row.created_at
      ? new Date(row.created_at).toISOString().slice(0, 10)
      : "";
  return date ? `${base}-${date}` : base;
}

/** Behåll första förekomsten per nyckel (rader bör vara sorterade nyast först). */
export function dedupePredictions<T extends PredictionKeyRow>(
  rows: T[],
  opts?: { includeDate?: boolean },
): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const r of rows) {
    const key = predictionMatchKey(r, opts);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(r);
  }
  return out;
}
