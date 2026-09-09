create extension if not exists pgcrypto;

create table if not exists public.hotels (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  is_reference_hotel boolean not null default false,
  official_site_enabled boolean not null default true,
  official_site_url text,
  trivago_enabled boolean not null default true,
  trivago_property_id text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.hotels is
  'Configuracao dos hoteis monitorados. Tarifas e pesquisas nao sao persistidas nesta fase.';

create unique index if not exists hotels_single_reference_idx
  on public.hotels ((is_reference_hotel))
  where is_reference_hotel;

create or replace function public.update_hotels_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

do $$
begin
  if not exists (
    select 1
    from pg_trigger
    where tgname = 'set_hotels_updated_at'
      and tgrelid = 'public.hotels'::regclass
  ) then
    create trigger set_hotels_updated_at
      before update on public.hotels
      for each row
      execute function public.update_hotels_updated_at();
  end if;
end;
$$;

alter table public.hotels enable row level security;

do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'hotels'
      and policyname = 'Active authenticated users can view active hotels'
  ) then
    create policy "Active authenticated users can view active hotels"
      on public.hotels
      for select
      to authenticated
      using (
        active = true
        and exists (
          select 1
          from public.profiles
          where profiles.id = auth.uid()
            and profiles.active = true
        )
      );
  end if;
end;
$$;

revoke insert, update, delete on table public.hotels from anon, authenticated;
grant select on table public.hotels to authenticated;

