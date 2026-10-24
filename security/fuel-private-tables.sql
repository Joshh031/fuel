-- Apply only after deploying fuel-data and the owner-authenticated web app.
-- The existing ChatGPT Worker uses its server-side service-role key.
-- No nutrition records are changed by this migration.
set local lock_timeout = '5s';
alter table public.meals enable row level security;
alter table public.exercise_log enable row level security;
alter table public.water_log enable row level security;
alter table public.weight_log enable row level security;
alter table public.push_subs enable row level security;
alter policy "allow all" on public.meals to service_role;
alter policy "Allow all" on public.exercise_log to service_role;
alter policy "allow all" on public.water_log to service_role;
alter policy "anon all" on public.weight_log to service_role;
revoke all privileges on table public.meals, public.exercise_log, public.water_log, public.weight_log, public.push_subs from public, anon, authenticated;
