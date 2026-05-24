CREATE TABLE IF NOT EXISTS public.trav_horse_cache (
  horse_id bigint PRIMARY KEY,
  payload jsonb NOT NULL DEFAULT '{}',
  fetched_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS trav_horse_cache_fetched_at_idx
  ON public.trav_horse_cache (fetched_at DESC);

ALTER TABLE public.trav_horse_cache ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Public read trav_horse_cache" ON public.trav_horse_cache;
CREATE POLICY "Public read trav_horse_cache" ON public.trav_horse_cache FOR SELECT USING (true);
