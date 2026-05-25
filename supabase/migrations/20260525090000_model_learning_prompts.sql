CREATE TABLE IF NOT EXISTS public.model_learning_prompts (
  scope text PRIMARY KEY,
  prompt_text text NOT NULL DEFAULT '',
  last_sample_count integer NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.model_learning_prompts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Public read model_learning_prompts" ON public.model_learning_prompts;
CREATE POLICY "Public read model_learning_prompts" ON public.model_learning_prompts FOR SELECT USING (true);
