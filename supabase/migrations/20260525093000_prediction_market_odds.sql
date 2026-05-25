ALTER TABLE public.predictions
  ADD COLUMN IF NOT EXISTS market_odds_open jsonb NULL,
  ADD COLUMN IF NOT EXISTS market_odds_last jsonb NULL,
  ADD COLUMN IF NOT EXISTS market_odds_closing jsonb NULL,
  ADD COLUMN IF NOT EXISTS market_odds_opened_at timestamptz NULL,
  ADD COLUMN IF NOT EXISTS market_odds_last_seen_at timestamptz NULL,
  ADD COLUMN IF NOT EXISTS market_odds_closed_at timestamptz NULL;

CREATE INDEX IF NOT EXISTS predictions_market_odds_event_idx
  ON public.predictions (event_id, market_odds_last_seen_at DESC)
  WHERE event_id IS NOT NULL;
