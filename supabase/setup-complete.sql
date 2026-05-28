-- PitchData — komplett schema för nytt Supabase-projekt
-- Kör i: https://supabase.com/dashboard/project/revmfdtofyewbwwdcrju/sql/new
-- (SQL Editor → New query → klistra in → Run)

-- 1) predictions
CREATE TABLE IF NOT EXISTS public.predictions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  league_id text NOT NULL,
  home_id text NOT NULL,
  away_id text NOT NULL,
  home_name text NOT NULL,
  away_name text NOT NULL,
  event_id text,
  event_date timestamptz,
  home_win_pct numeric NOT NULL,
  draw_pct numeric NOT NULL,
  away_win_pct numeric NOT NULL,
  predicted_score text NOT NULL,
  predicted_outcome text NOT NULL,
  confidence text NOT NULL,
  betting_tip text,
  key_factors jsonb,
  lineup_released boolean DEFAULT false,
  actual_home_score int,
  actual_away_score int,
  actual_outcome text,
  brier_score numeric,
  resolved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  round integer,
  postmortem jsonb,
  hidden_from_today_at timestamptz,
  btts_call text,
  btts_reason text,
  model_version integer DEFAULT 1,
  market_odds_open jsonb,
  market_odds_last jsonb,
  market_odds_closing jsonb,
  market_odds_opened_at timestamptz,
  market_odds_last_seen_at timestamptz,
  market_odds_closed_at timestamptz
);

CREATE INDEX IF NOT EXISTS predictions_league_idx ON public.predictions (league_id, created_at DESC);
CREATE INDEX IF NOT EXISTS predictions_unresolved_idx ON public.predictions (resolved_at) WHERE resolved_at IS NULL;
CREATE INDEX IF NOT EXISTS predictions_event_idx ON public.predictions (event_id) WHERE event_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS predictions_market_odds_event_idx
  ON public.predictions (event_id, market_odds_last_seen_at DESC)
  WHERE event_id IS NOT NULL;

ALTER TABLE public.predictions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Public read predictions" ON public.predictions;
CREATE POLICY "Public read predictions" ON public.predictions FOR SELECT USING (true);

-- Skrivning sker via service_role (server-side), inte publikt insert/update.

-- 2) archived_predictions
CREATE TABLE IF NOT EXISTS public.archived_predictions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  original_id uuid,
  league_id text NOT NULL,
  season text NOT NULL,
  home_id text NOT NULL,
  away_id text NOT NULL,
  home_name text NOT NULL,
  away_name text NOT NULL,
  event_id text,
  event_date timestamptz,
  home_win_pct numeric NOT NULL,
  draw_pct numeric NOT NULL,
  away_win_pct numeric NOT NULL,
  predicted_score text NOT NULL,
  predicted_outcome text NOT NULL,
  confidence text NOT NULL,
  betting_tip text,
  key_factors jsonb,
  actual_home_score int,
  actual_away_score int,
  actual_outcome text,
  brier_score numeric,
  postmortem jsonb,
  round int,
  resolved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  archived_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_archived_predictions_league_season
  ON public.archived_predictions (league_id, season);

-- 3) archived_seasons (historik från ESPN backfill)
CREATE TABLE IF NOT EXISTS public.archived_seasons (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  league_id text NOT NULL,
  season text NOT NULL,
  event_id text,
  event_date timestamptz,
  home_id text,
  away_id text,
  home_name text NOT NULL,
  away_name text NOT NULL,
  home_score int,
  away_score int,
  outcome text,
  btts boolean,
  round int,
  raw jsonb,
  fetched_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (league_id, season, event_id)
);

CREATE INDEX IF NOT EXISTS idx_archived_seasons_league
  ON public.archived_seasons (league_id, season);

-- 4) league_season_state
CREATE TABLE IF NOT EXISTS public.league_season_state (
  league_id text PRIMARY KEY,
  current_season text NOT NULL,
  last_seen_round int NOT NULL DEFAULT 0,
  season_started_at timestamptz NOT NULL DEFAULT now(),
  backfilled_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- 5) league_prompts
CREATE TABLE IF NOT EXISTS public.league_prompts (
  league_id text PRIMARY KEY,
  prompt_text text NOT NULL DEFAULT '',
  last_resolved_count integer NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.archived_predictions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.archived_seasons ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.league_season_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.league_prompts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Public read archived_predictions" ON public.archived_predictions;
CREATE POLICY "Public read archived_predictions" ON public.archived_predictions FOR SELECT USING (true);

DROP POLICY IF EXISTS "Public read archived_seasons" ON public.archived_seasons;
CREATE POLICY "Public read archived_seasons" ON public.archived_seasons FOR SELECT USING (true);

DROP POLICY IF EXISTS "Public read league_season_state" ON public.league_season_state;
CREATE POLICY "Public read league_season_state" ON public.league_season_state FOR SELECT USING (true);

DROP POLICY IF EXISTS "Public read league_prompts" ON public.league_prompts;
CREATE POLICY "Public read league_prompts" ON public.league_prompts FOR SELECT USING (true);

-- 6) league_model_params (tränade parametrar per liga från 3 års historik)
CREATE TABLE IF NOT EXISTS public.league_model_params (
  league_id text PRIMARY KEY,
  home_advantage numeric NOT NULL DEFAULT 1.18,
  market_blend_weight numeric NOT NULL DEFAULT 0.48,
  avg_goals numeric NOT NULL DEFAULT 2.65,
  home_win_rate numeric,
  draw_rate numeric,
  away_win_rate numeric,
  btts_rate numeric,
  backtest_matches integer NOT NULL DEFAULT 0,
  backtest_hit_rate numeric,
  backtest_brier numeric,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.league_model_params ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Public read league_model_params" ON public.league_model_params;
CREATE POLICY "Public read league_model_params" ON public.league_model_params FOR SELECT USING (true);

-- 7) opta_cache (Playwright-synkad Opta-data)
CREATE TABLE IF NOT EXISTS public.opta_cache (
  cache_key text PRIMARY KEY,
  payload jsonb NOT NULL DEFAULT '{}',
  fetched_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.opta_cache ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Public read opta_cache" ON public.opta_cache;
CREATE POLICY "Public read opta_cache" ON public.opta_cache FOR SELECT USING (true);

-- 8) football_match_intel + football_rulebook (analys & regelbok sedan sept 2025)
CREATE TABLE IF NOT EXISTS public.football_match_intel (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  league_id text NOT NULL,
  season text NOT NULL,
  event_id text NOT NULL,
  event_date timestamptz,
  home_id text,
  away_id text,
  home_name text NOT NULL,
  away_name text NOT NULL,
  home_score int,
  away_score int,
  outcome text,
  btts boolean,
  analysis jsonb NOT NULL DEFAULT '{}'::jsonb,
  opta_payload jsonb,
  espn_summary jsonb,
  rule_tags text[] DEFAULT '{}',
  analyzed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (league_id, event_id)
);
CREATE INDEX IF NOT EXISTS idx_football_match_intel_date ON public.football_match_intel (event_date DESC);

CREATE TABLE IF NOT EXISTS public.football_rulebook (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  version int NOT NULL DEFAULT 1,
  is_active boolean NOT NULL DEFAULT true,
  rules jsonb NOT NULL DEFAULT '[]'::jsonb,
  backtest jsonb,
  sample_matches int NOT NULL DEFAULT 0,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.football_match_intel ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.football_rulebook ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Public read football_match_intel" ON public.football_match_intel;
CREATE POLICY "Public read football_match_intel" ON public.football_match_intel FOR SELECT USING (true);
DROP POLICY IF EXISTS "Public read football_rulebook" ON public.football_rulebook;
CREATE POLICY "Public read football_rulebook" ON public.football_rulebook FOR SELECT USING (true);
