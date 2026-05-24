-- Kör detta i SQL Editor om du redan skapat tabellerna tidigare:
-- https://supabase.com/dashboard/project/revmfdtofyewbwwdcrju/sql/new

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
