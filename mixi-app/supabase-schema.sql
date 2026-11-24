create table if not exists public.user_backups (
  user_id uuid primary key references auth.users (id) on delete cascade,
  payload jsonb not null check (jsonb_typeof(payload) = 'object'),
  updated_at timestamptz not null default now()
);

alter table public.user_backups enable row level security;

revoke all on table public.user_backups from anon, authenticated;
grant select, insert, update on table public.user_backups to authenticated;

drop policy if exists "Users can read their own backup" on public.user_backups;
create policy "Users can read their own backup"
  on public.user_backups for select
  to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists "Users can create their own backup" on public.user_backups;
create policy "Users can create their own backup"
  on public.user_backups for insert
  to authenticated
  with check ((select auth.uid()) = user_id);

drop policy if exists "Users can update their own backup" on public.user_backups;
create policy "Users can update their own backup"
  on public.user_backups for update
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop function if exists public.get_public_memories();

create or replace function public.get_public_altars()
returns table (
  id text,
  nombre text,
  x numeric,
  y numeric
)
language sql
stable
security definer
set search_path = pg_catalog
as $$
  select
    profile ->> 'id',
    profile ->> 'nombre',
    (profile -> 'puntoCielo' ->> 'x')::numeric,
    (profile -> 'puntoCielo' ->> 'y')::numeric
  from public.user_backups as backup
  cross join lateral jsonb_array_elements(
    case
      when jsonb_typeof(backup.payload -> 'perfiles') = 'array'
        then backup.payload -> 'perfiles'
      else '[]'::jsonb
    end
  ) as profiles(profile)
  where profile -> 'privado' is distinct from 'true'::jsonb
    and jsonb_typeof(profile) = 'object'
    and jsonb_typeof(profile -> 'id') = 'string'
    and jsonb_typeof(profile -> 'nombre') = 'string'
    and jsonb_typeof(profile -> 'puntoCielo') = 'object'
    and jsonb_typeof(profile -> 'puntoCielo' -> 'x') = 'number'
    and jsonb_typeof(profile -> 'puntoCielo' -> 'y') = 'number'
    and case
      when jsonb_typeof(profile -> 'puntoCielo' -> 'x') = 'number'
        then (profile -> 'puntoCielo' ->> 'x')::numeric between 0 and 100
      else false
    end
    and case
      when jsonb_typeof(profile -> 'puntoCielo' -> 'y') = 'number'
        then (profile -> 'puntoCielo' ->> 'y')::numeric between 0 and 100
      else false
    end;
$$;

revoke all on function public.get_public_altars() from public, anon, authenticated;
grant execute on function public.get_public_altars() to anon, authenticated;
