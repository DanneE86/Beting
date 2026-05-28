-- Fotboll: per-match analys, Opta/ESPN-enrichment och tränad regelbok
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

CREATE INDEX IF NOT EXISTS idx_football_match_intel_date
  ON public.football_match_intel (event_date DESC);

CREATE INDEX IF NOT EXISTS idx_football_match_intel_league
  ON public.football_match_intel (league_id, season);

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

CREATE INDEX IF NOT EXISTS idx_football_rulebook_active
  ON public.football_rulebook (is_active, created_at DESC);

ALTER TABLE public.football_match_intel ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.football_rulebook ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Public read football_match_intel" ON public.football_match_intel;
CREATE POLICY "Public read football_match_intel" ON public.football_match_intel FOR SELECT USING (true);

DROP POLICY IF EXISTS "Public read football_rulebook" ON public.football_rulebook;
CREATE POLICY "Public read football_rulebook" ON public.football_rulebook FOR SELECT USING (true);
