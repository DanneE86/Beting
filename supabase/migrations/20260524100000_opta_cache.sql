CREATE TABLE IF NOT EXISTS public.opta_cache (
  cache_key text PRIMARY KEY,
  payload jsonb NOT NULL DEFAULT '{}',
  fetched_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.opta_cache ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Public read opta_cache" ON public.opta_cache;
CREATE POLICY "Public read opta_cache" ON public.opta_cache FOR SELECT USING (true);
