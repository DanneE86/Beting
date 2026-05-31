CREATE TABLE IF NOT EXISTS public.trav_favorite_win_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  report_key text NOT NULL UNIQUE,
  from_date date NOT NULL,
  to_date date NOT NULL,
  lookback_days integer NOT NULL,
  game_types text[] NOT NULL,
  races_in_buckets integer NOT NULL,
  favorite_wins integer NOT NULL,
  win_pct numeric(5, 2) NOT NULL,
  races_skipped_outside_buckets integer NOT NULL DEFAULT 0,
  computed_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS trav_favorite_win_reports_computed_idx
  ON public.trav_favorite_win_reports (computed_at DESC);

CREATE TABLE IF NOT EXISTS public.trav_favorite_win_buckets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id uuid NOT NULL REFERENCES public.trav_favorite_win_reports (id) ON DELETE CASCADE,
  bucket_key text NOT NULL,
  streck_min numeric(5, 2) NOT NULL,
  streck_max numeric(5, 2) NOT NULL,
  sort_order smallint NOT NULL,
  race_count integer NOT NULL,
  favorite_wins integer NOT NULL,
  win_pct numeric(5, 2) NOT NULL,
  UNIQUE (report_id, bucket_key)
);

CREATE INDEX IF NOT EXISTS trav_favorite_win_buckets_report_idx
  ON public.trav_favorite_win_buckets (report_id, sort_order);

ALTER TABLE public.trav_favorite_win_reports ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Public read trav_favorite_win_reports" ON public.trav_favorite_win_reports;
CREATE POLICY "Public read trav_favorite_win_reports"
  ON public.trav_favorite_win_reports FOR SELECT USING (true);

ALTER TABLE public.trav_favorite_win_buckets ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Public read trav_favorite_win_buckets" ON public.trav_favorite_win_buckets;
CREATE POLICY "Public read trav_favorite_win_buckets"
  ON public.trav_favorite_win_buckets FOR SELECT USING (true);
