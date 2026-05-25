CREATE TABLE IF NOT EXISTS public.trav_predictions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  game_id text NOT NULL,
  game_type text NOT NULL,
  game_date timestamptz NULL,
  status text NOT NULL DEFAULT 'pending',
  snapshot_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  system_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  legs_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  meta_json jsonb NULL,
  analysis_model text NULL,
  resolved_at timestamptz NULL,
  result_json jsonb NULL,
  payouts_json jsonb NULL,
  winning_numbers_json jsonb NULL,
  system_hit_summary jsonb NULL,
  postmortem_json jsonb NULL,
  learning_prompt text NULL,
  model_version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS trav_predictions_game_idx
  ON public.trav_predictions (game_id, created_at DESC);

CREATE INDEX IF NOT EXISTS trav_predictions_resolved_idx
  ON public.trav_predictions (resolved_at, created_at DESC);

CREATE INDEX IF NOT EXISTS trav_predictions_type_idx
  ON public.trav_predictions (game_type, created_at DESC);

ALTER TABLE public.trav_predictions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Public read trav_predictions" ON public.trav_predictions;
CREATE POLICY "Public read trav_predictions" ON public.trav_predictions FOR SELECT USING (true);

CREATE TABLE IF NOT EXISTS public.trav_learning_prompts (
  game_type text PRIMARY KEY,
  prompt_text text NOT NULL DEFAULT '',
  last_resolved_count integer NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.trav_learning_prompts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Public read trav_learning_prompts" ON public.trav_learning_prompts;
CREATE POLICY "Public read trav_learning_prompts" ON public.trav_learning_prompts FOR SELECT USING (true);
