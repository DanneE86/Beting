-- Per-match team statistics from ESPN summary endpoint
create table if not exists football_match_stats (
  id bigserial primary key,
  league_id text not null,
  season text not null,
  event_id text not null,
  event_date timestamptz,
  home_team_id text,
  home_team_name text,
  away_team_id text,
  away_team_name text,

  -- Bollinehav / Possession (%)
  home_possession numeric,
  away_possession numeric,

  -- Passningar / Passes
  home_passes_total int,
  home_passes_accurate int,
  home_pass_pct numeric,
  away_passes_total int,
  away_passes_accurate int,
  away_pass_pct numeric,

  -- Gula/roda kort / Cards
  home_yellow_cards int,
  home_red_cards int,
  away_yellow_cards int,
  away_red_cards int,

  -- Skott / Shots
  home_shots int,
  home_shots_on_target int,
  away_shots int,
  away_shots_on_target int,

  -- Regelbrott / Fouls
  home_fouls int,
  away_fouls int,

  -- Hornor / Corners
  home_corners int,
  away_corners int,

  raw jsonb,
  fetched_at timestamptz default now(),
  updated_at timestamptz default now(),

  unique(league_id, event_id)
);

create index if not exists football_match_stats_league_season
  on football_match_stats(league_id, season);

create index if not exists football_match_stats_date
  on football_match_stats(event_date desc);

-- Aggregated player stats per league/season (viktiga spelare)
create table if not exists football_player_season_stats (
  id bigserial primary key,
  league_id text not null,
  season text not null,
  athlete_id text not null,
  athlete_name text,
  team_id text,
  team_name text,

  -- Matcher / Matches
  appearances int default 0,
  starts int default 0,
  sub_ins int default 0,

  -- Mal och assist / Goals and assists
  goals int default 0,
  assists int default 0,

  -- Kort / Cards
  yellow_cards int default 0,
  red_cards int default 0,

  -- Skott / Shots
  shots int default 0,
  shots_on_target int default 0,

  -- Raddningar (malvakter) / Saves (goalkeepers)
  saves int default 0,
  goals_conceded int default 0,

  -- Viktighetspoang: goals*3 + assists*2 + starts*0.5 + sub_ins*0.2
  importance_score numeric generated always as (
    goals * 3.0 + assists * 2.0 + starts * 0.5 + sub_ins * 0.2
  ) stored,

  updated_at timestamptz default now(),

  unique(league_id, season, athlete_id)
);

create index if not exists football_player_season_stats_league_season
  on football_player_season_stats(league_id, season);

create index if not exists football_player_season_stats_importance
  on football_player_season_stats(importance_score desc);

create index if not exists football_player_season_stats_team
  on football_player_season_stats(team_id, league_id, season);
