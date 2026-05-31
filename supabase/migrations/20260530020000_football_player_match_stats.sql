-- Per-match player statistics from ESPN summary endpoint
-- One row per player per match

create table if not exists football_player_match_stats (
  id bigserial primary key,
  league_id text not null,
  season text not null,
  event_id text not null,
  event_date timestamptz,

  athlete_id text not null,
  athlete_name text,
  team_id text,
  team_name text,
  home_away text,       -- 'home' | 'away'

  -- Lineup-info
  position text,
  jersey text,
  formation_place text,
  starter boolean default false,
  subbed_in boolean default false,
  subbed_out boolean default false,

  -- Mål / Goals
  goals int default 0,
  assists int default 0,
  own_goals int default 0,

  -- Skott / Shots
  shots int default 0,
  shots_on_target int default 0,

  -- Målvakt / Goalkeeper
  saves int default 0,
  shots_faced int default 0,
  goals_conceded int default 0,

  -- Regelbrott / Fouls
  fouls_committed int default 0,
  fouls_suffered int default 0,

  -- Övrigt / Other
  yellow_cards int default 0,
  red_cards int default 0,
  offsides int default 0,

  fetched_at timestamptz default now(),

  unique(league_id, event_id, athlete_id)
);

create index if not exists fpmstats_league_season
  on football_player_match_stats(league_id, season);

create index if not exists fpmstats_event
  on football_player_match_stats(event_id);

create index if not exists fpmstats_athlete
  on football_player_match_stats(athlete_id, league_id, season);

create index if not exists fpmstats_date
  on football_player_match_stats(event_date desc);

-- RLS
alter table football_player_match_stats enable row level security;
do $$ begin
  if not exists (
    select 1 from pg_policies
    where tablename = 'football_player_match_stats' and policyname = 'public read'
  ) then
    execute 'create policy "public read" on football_player_match_stats for select using (true)';
  end if;
end $$;
