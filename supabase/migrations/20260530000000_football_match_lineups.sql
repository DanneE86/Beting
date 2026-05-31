-- Starting lineups per match, fetched from ESPN summary endpoint
create table if not exists football_match_lineups (
  id bigserial primary key,
  league_id text not null,
  season text not null,
  event_id text not null,
  event_date timestamptz,
  home_team_id text,
  home_team_name text,
  away_team_id text,
  away_team_name text,
  home_formation text,
  away_formation text,

  -- [{id, name, position, jersey}]
  home_starters jsonb,
  away_starters jsonb,
  home_bench jsonb,
  away_bench jsonb,

  fetched_at timestamptz default now(),

  unique(league_id, event_id)
);

create index if not exists football_match_lineups_league_season
  on football_match_lineups(league_id, season);

create index if not exists football_match_lineups_date
  on football_match_lineups(event_date desc);
