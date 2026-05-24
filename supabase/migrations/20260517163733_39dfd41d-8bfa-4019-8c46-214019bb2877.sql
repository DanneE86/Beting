create table public.predictions (
  id uuid primary key default gen_random_uuid(),
  league_id text not null,
  home_id text not null,
  away_id text not null,
  home_name text not null,
  away_name text not null,
  event_id text,
  event_date timestamptz,
  home_win_pct numeric not null,
  draw_pct numeric not null,
  away_win_pct numeric not null,
  predicted_score text not null,
  predicted_outcome text not null,
  confidence text not null,
  betting_tip text,
  key_factors jsonb,
  lineup_released boolean default false,
  actual_home_score int,
  actual_away_score int,
  actual_outcome text,
  brier_score numeric,
  resolved_at timestamptz,
  created_at timestamptz not null default now()
);

create index predictions_league_idx on public.predictions(league_id, created_at desc);
create index predictions_unresolved_idx on public.predictions(resolved_at) where resolved_at is null;
create index predictions_event_idx on public.predictions(event_id) where event_id is not null;

alter table public.predictions enable row level security;

create policy "Public read predictions"
  on public.predictions for select
  using (true);

create policy "Public insert predictions"
  on public.predictions for insert
  with check (true);

create policy "Public update predictions"
  on public.predictions for update
  using (true);