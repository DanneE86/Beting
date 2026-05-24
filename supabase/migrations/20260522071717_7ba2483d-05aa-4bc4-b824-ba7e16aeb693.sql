
CREATE TABLE public.archived_predictions (
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
CREATE INDEX idx_archived_predictions_league_season ON public.archived_predictions(league_id, season);

CREATE TABLE public.archived_seasons (
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
CREATE INDEX idx_archived_seasons_league ON public.archived_seasons(league_id, season);

CREATE TABLE public.league_season_state (
  league_id text PRIMARY KEY,
  current_season text NOT NULL,
  last_seen_round int NOT NULL DEFAULT 0,
  season_started_at timestamptz NOT NULL DEFAULT now(),
  backfilled_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.archived_predictions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.archived_seasons ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.league_season_state ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public read archived_predictions" ON public.archived_predictions FOR SELECT USING (true);
CREATE POLICY "Public read archived_seasons" ON public.archived_seasons FOR SELECT USING (true);
CREATE POLICY "Public read league_season_state" ON public.league_season_state FOR SELECT USING (true);
