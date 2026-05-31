-- Enable RLS on football stats tables (public read-only data)
ALTER TABLE public.football_match_lineups ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.football_match_stats ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.football_player_season_stats ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='football_match_lineups' AND policyname='public read') THEN
    CREATE POLICY "public read" ON public.football_match_lineups FOR SELECT USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='football_match_stats' AND policyname='public read') THEN
    CREATE POLICY "public read" ON public.football_match_stats FOR SELECT USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='football_player_season_stats' AND policyname='public read') THEN
    CREATE POLICY "public read" ON public.football_player_season_stats FOR SELECT USING (true);
  END IF;
END $$;
