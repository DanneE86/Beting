-- BTTS + modellversion som egna kolumner (samma data överallt i appen)
ALTER TABLE public.predictions ADD COLUMN IF NOT EXISTS btts_call text;
ALTER TABLE public.predictions ADD COLUMN IF NOT EXISTS btts_reason text;
ALTER TABLE public.predictions ADD COLUMN IF NOT EXISTS model_version integer DEFAULT 1;

COMMENT ON COLUMN public.predictions.btts_call IS 'ja | nej | osäker — statistikmodell BTTS';
COMMENT ON COLUMN public.predictions.btts_reason IS 'Motivering till btts_call';
COMMENT ON COLUMN public.predictions.model_version IS 'Prognosmodellversion; höjs vid modelländringar';
