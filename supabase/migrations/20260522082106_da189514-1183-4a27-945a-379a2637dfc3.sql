CREATE TABLE public.league_prompts (
  league_id text PRIMARY KEY,
  prompt_text text NOT NULL DEFAULT '',
  last_resolved_count integer NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.league_prompts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public read league_prompts"
ON public.league_prompts
FOR SELECT
USING (true);