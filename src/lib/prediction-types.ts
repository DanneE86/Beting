import type { BttsCall } from "./prediction-meta";

/** Rad som visas i PredictionResultsTable (DB + UI). */
export type PredictionListRow = {
  id: string;
  home_name: string;
  away_name: string;
  predicted_outcome: string | null;
  predicted_score: string | null;
  confidence: number | string | null;
  actual_outcome?: string | null;
  actual_home_score?: number | null;
  actual_away_score?: number | null;
  event_date?: string | null;
  created_at?: string | null;
  round?: number | null;
  league_id?: string | null;
  postmortem?: unknown;
  btts_call?: string | null;
  btts_reason?: string | null;
  key_factors?: unknown;
  betting_tip?: string | null;
  home_win_pct?: number | string | null;
  draw_pct?: number | string | null;
  away_win_pct?: number | string | null;
};

export type { BttsCall };

export type PostmortemData = {
  verdict?: "right" | "wrong";
  exactScore?: boolean;
  summary?: string;
  why?: string[];
  luck?: { level: "låg" | "medel" | "hög"; reason: string };
  lessons?: string[];
  model_mistakes?: string[];
  signals_missed?: string[];
  alternative_pick?: string;
  bttsCall?: BttsCall;
  bttsReason?: string;
  preliminary?: boolean;
  match_stats?: {
    shots?: { home: number; away: number };
    shotsOnTarget?: { home: number; away: number };
    possession?: { home: number; away: number };
    xg?: { home: number; away: number };
    redCards?: { home: number; away: number };
  };
  generated_at?: string;
  model?: string;
};
