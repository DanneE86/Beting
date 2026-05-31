-- Add missing columns to football_player_season_stats
-- New fields available from ESPN: fouls, offsides, own_goals, shots_faced

alter table football_player_season_stats
  add column if not exists fouls_committed int default 0,
  add column if not exists fouls_suffered  int default 0,
  add column if not exists offsides        int default 0,
  add column if not exists own_goals       int default 0,
  add column if not exists shots_faced     int default 0;
