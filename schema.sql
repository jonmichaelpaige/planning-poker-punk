-- Run this in the Supabase SQL editor for the project referenced by config.js.
-- Logs room creations and counts reveals. No user info is stored.

create table if not exists public.room_logs (
  id bigint generated always as identity primary key,
  room_name text not null,
  reveal_count integer not null default 0
);

alter table public.room_logs enable row level security;

-- Simple, permissive policies for the anon key used client-side.
create policy "room_logs anon insert" on public.room_logs
  for insert to anon with check (true);

create policy "room_logs anon select" on public.room_logs
  for select to anon using (true);

create policy "room_logs anon update" on public.room_logs
  for update to anon using (true) with check (true);
