-- Salão PWA V2 — Supabase schema
-- Run once in Supabase > SQL Editor > New query > Run

create extension if not exists pgcrypto;

do $$ begin
  create type public.member_role as enum ('owner','manager','employee');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.appointment_status as enum ('pending','confirmed','completed','cancelled','no_show');
exception when duplicate_object then null; end $$;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.salons (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  timezone text not null default 'Europe/Lisbon',
  currency text not null default 'EUR',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.salon_members (
  id uuid primary key default gen_random_uuid(),
  salon_id uuid not null references public.salons(id) on delete cascade,
  user_id uuid references auth.users(id) on delete set null,
  display_name text not null,
  role public.member_role not null default 'employee',
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists salon_members_unique_user_per_salon
  on public.salon_members(salon_id, user_id) where user_id is not null;
create index if not exists salon_members_user_id_idx on public.salon_members(user_id);

create table if not exists public.services (
  id uuid primary key default gen_random_uuid(),
  salon_id uuid not null references public.salons(id) on delete cascade,
  name text not null,
  duration_minutes integer not null default 45 check (duration_minutes > 0),
  price numeric(10,2) not null default 0,
  recurrence_weeks integer check (recurrence_weeks is null or recurrence_weeks > 0),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists services_salon_id_idx on public.services(salon_id);

create table if not exists public.clients (
  id uuid primary key default gen_random_uuid(),
  salon_id uuid not null references public.salons(id) on delete cascade,
  name text not null,
  phone text,
  email text,
  notes text,
  preferred_service_id uuid references public.services(id) on delete set null,
  recurrence_weeks integer check (recurrence_weeks is null or recurrence_weeks > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists clients_salon_id_idx on public.clients(salon_id);
create index if not exists clients_name_idx on public.clients(salon_id, name);

create table if not exists public.appointments (
  id uuid primary key default gen_random_uuid(),
  salon_id uuid not null references public.salons(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  service_id uuid references public.services(id) on delete set null,
  employee_id uuid not null references public.salon_members(id) on delete restrict,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  status public.appointment_status not null default 'pending',
  notes text,
  created_by uuid references auth.users(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_at > starts_at)
);
create index if not exists appointments_salon_start_idx on public.appointments(salon_id, starts_at);
create index if not exists appointments_employee_start_idx on public.appointments(employee_id, starts_at);

create table if not exists public.visits (
  id uuid primary key default gen_random_uuid(),
  salon_id uuid not null references public.salons(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  appointment_id uuid references public.appointments(id) on delete set null,
  employee_id uuid not null references public.salon_members(id) on delete restrict,
  service_id uuid references public.services(id) on delete set null,
  occurred_on date not null default current_date,
  service_label text,
  color_formula text,
  treatment_products text,
  notes text,
  amount_paid numeric(10,2) not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists visits_client_date_idx on public.visits(client_id, occurred_on desc);
create index if not exists visits_salon_id_idx on public.visits(salon_id);

create table if not exists public.products (
  id uuid primary key default gen_random_uuid(),
  salon_id uuid not null references public.salons(id) on delete cascade,
  name text not null,
  brand text,
  barcode text,
  unit text not null default 'un.',
  current_stock numeric(12,3) not null default 0,
  min_stock numeric(12,3) not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists products_unique_barcode_per_salon
  on public.products(salon_id, barcode) where barcode is not null and barcode <> '';
create index if not exists products_salon_id_idx on public.products(salon_id);

create table if not exists public.stock_movements (
  id uuid primary key default gen_random_uuid(),
  salon_id uuid not null references public.salons(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete cascade,
  member_id uuid references public.salon_members(id) on delete set null,
  quantity_delta numeric(12,3) not null check (quantity_delta <> 0),
  reason text not null default 'manual',
  notes text,
  created_at timestamptz not null default now()
);
create index if not exists stock_movements_product_idx on public.stock_movements(product_id, created_at desc);

create table if not exists public.salons_invites (
  id uuid primary key default gen_random_uuid(),
  salon_id uuid not null references public.salons(id) on delete cascade,
  code text not null unique,
  display_name text not null,
  role public.member_role not null default 'employee',
  expires_at timestamptz not null default (now() + interval '14 days'),
  used_by uuid references auth.users(id) on delete set null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);

-- updated_at helper
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

do $$
declare t text;
begin
  foreach t in array array['profiles','salons','salon_members','services','clients','appointments','visits','products'] loop
    execute format('drop trigger if exists set_%I_updated_at on public.%I', t, t);
    execute format('create trigger set_%I_updated_at before update on public.%I for each row execute function public.set_updated_at()', t, t);
  end loop;
end $$;

-- Create a public profile row after Auth signup
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles(id, full_name)
  values (new.id, coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email, '@', 1)))
  on conflict (id) do nothing;
  return new;
end;
$$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

-- Security helper functions. SECURITY DEFINER avoids RLS recursion.
create or replace function public.is_salon_member(target_salon uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.salon_members sm
    where sm.salon_id = target_salon
      and sm.user_id = auth.uid()
      and sm.active = true
  );
$$;

create or replace function public.is_salon_manager(target_salon uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.salon_members sm
    where sm.salon_id = target_salon
      and sm.user_id = auth.uid()
      and sm.active = true
      and sm.role in ('owner','manager')
  );
$$;

create or replace function public.my_member_id(target_salon uuid)
returns uuid
language sql stable security definer set search_path = public
as $$
  select sm.id from public.salon_members sm
  where sm.salon_id = target_salon
    and sm.user_id = auth.uid()
    and sm.active = true
  order by sm.created_at
  limit 1;
$$;

-- First-login onboarding: creates a salon + owner + default services.
create or replace function public.create_salon_for_current_user(p_name text)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  v_salon uuid;
  v_name text;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if exists(select 1 from public.salon_members where user_id = auth.uid() and active) then
    raise exception 'User already belongs to a salon';
  end if;
  v_name := nullif(trim(p_name), '');
  if v_name is null then raise exception 'Salon name is required'; end if;

  insert into public.salons(name) values(v_name) returning id into v_salon;
  insert into public.salon_members(salon_id, user_id, display_name, role)
  values(
    v_salon,
    auth.uid(),
    coalesce((select p.full_name from public.profiles p where p.id = auth.uid()), 'Gerente'),
    'owner'
  );

  insert into public.services(salon_id,name,duration_minutes,price,recurrence_weeks) values
    (v_salon,'Coloração',90,45,5),
    (v_salon,'Corte',45,22,8),
    (v_salon,'Hidratação',45,28,6),
    (v_salon,'Madeixas',150,70,10),
    (v_salon,'Brushing',35,15,2);
  return v_salon;
end;
$$;

-- Stock audit helper. All stock changes go through a movement row.
create or replace function public.record_stock_movement(
  p_product uuid,
  p_delta numeric,
  p_reason text default 'manual',
  p_notes text default null
)
returns numeric
language plpgsql security definer set search_path = public
as $$
declare
  v_salon uuid;
  v_member uuid;
  v_new numeric;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if p_delta = 0 then raise exception 'Delta cannot be zero'; end if;

  select salon_id into v_salon from public.products where id = p_product for update;
  if v_salon is null then raise exception 'Product not found'; end if;
  if not public.is_salon_member(v_salon) then raise exception 'Not authorized'; end if;
  v_member := public.my_member_id(v_salon);

  update public.products
  set current_stock = greatest(0, current_stock + p_delta)
  where id = p_product
  returning current_stock into v_new;

  insert into public.stock_movements(salon_id, product_id, member_id, quantity_delta, reason, notes)
  values(v_salon, p_product, v_member, p_delta, coalesce(nullif(trim(p_reason),''),'manual'), p_notes);

  return v_new;
end;
$$;

-- Team invitation helpers (for later use in the app).
create or replace function public.create_team_invite(p_display_name text, p_role public.member_role default 'employee')
returns text
language plpgsql security definer set search_path = public
as $$
declare
  v_salon uuid;
  v_code text;
begin
  select salon_id into v_salon from public.salon_members
  where user_id = auth.uid() and active and role in ('owner','manager')
  order by created_at limit 1;
  if v_salon is null then raise exception 'Manager access required'; end if;
  if p_role = 'owner' then raise exception 'Owner invites are not allowed'; end if;
  v_code := upper(substr(encode(gen_random_bytes(6),'hex'),1,8));
  insert into public.salons_invites(salon_id,code,display_name,role)
  values(v_salon,v_code,coalesce(nullif(trim(p_display_name),''),'Colaborador'),p_role);
  return v_code;
end;
$$;

create or replace function public.accept_team_invite(p_code text)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  v_inv public.salons_invites%rowtype;
  v_member uuid;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if exists(select 1 from public.salon_members where user_id=auth.uid() and active) then
    raise exception 'User already belongs to a salon';
  end if;
  select * into v_inv from public.salons_invites
  where code = upper(trim(p_code)) and used_at is null and expires_at > now()
  for update;
  if v_inv.id is null then raise exception 'Invalid or expired invite'; end if;

  insert into public.salon_members(salon_id,user_id,display_name,role)
  values(v_inv.salon_id,auth.uid(),v_inv.display_name,v_inv.role)
  returning id into v_member;
  update public.salons_invites set used_by=auth.uid(), used_at=now() where id=v_inv.id;
  return v_member;
end;
$$;

-- Grants
revoke all on function public.is_salon_member(uuid) from public;
revoke all on function public.is_salon_manager(uuid) from public;
revoke all on function public.my_member_id(uuid) from public;
grant execute on function public.is_salon_member(uuid) to authenticated;
grant execute on function public.is_salon_manager(uuid) to authenticated;
grant execute on function public.my_member_id(uuid) to authenticated;
grant execute on function public.create_salon_for_current_user(text) to authenticated;
grant execute on function public.record_stock_movement(uuid,numeric,text,text) to authenticated;
grant execute on function public.create_team_invite(text,public.member_role) to authenticated;
grant execute on function public.accept_team_invite(text) to authenticated;

grant usage on schema public to authenticated;
grant select, insert, update, delete on public.profiles, public.salons, public.salon_members, public.services, public.clients, public.appointments, public.visits, public.products, public.stock_movements, public.salons_invites to authenticated;

-- RLS
alter table public.profiles enable row level security;
alter table public.salons enable row level security;
alter table public.salon_members enable row level security;
alter table public.services enable row level security;
alter table public.clients enable row level security;
alter table public.appointments enable row level security;
alter table public.visits enable row level security;
alter table public.products enable row level security;
alter table public.stock_movements enable row level security;
alter table public.salons_invites enable row level security;

-- Drop named policies so the file is safe to re-run.
drop policy if exists profiles_self_select on public.profiles;
drop policy if exists profiles_self_update on public.profiles;
create policy profiles_self_select on public.profiles for select to authenticated using (id = auth.uid());
create policy profiles_self_update on public.profiles for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

drop policy if exists salons_member_select on public.salons;
drop policy if exists salons_manager_update on public.salons;
create policy salons_member_select on public.salons for select to authenticated using (public.is_salon_member(id));
create policy salons_manager_update on public.salons for update to authenticated using (public.is_salon_manager(id)) with check (public.is_salon_manager(id));

drop policy if exists members_member_select on public.salon_members;
drop policy if exists members_manager_write on public.salon_members;
create policy members_member_select on public.salon_members for select to authenticated using (public.is_salon_member(salon_id));
create policy members_manager_write on public.salon_members for update to authenticated using (public.is_salon_manager(salon_id)) with check (public.is_salon_manager(salon_id));

drop policy if exists services_member_select on public.services;
drop policy if exists services_manager_insert on public.services;
drop policy if exists services_manager_update on public.services;
drop policy if exists services_manager_delete on public.services;
create policy services_member_select on public.services for select to authenticated using (public.is_salon_member(salon_id));
create policy services_manager_insert on public.services for insert to authenticated with check (public.is_salon_manager(salon_id));
create policy services_manager_update on public.services for update to authenticated using (public.is_salon_manager(salon_id)) with check (public.is_salon_manager(salon_id));
create policy services_manager_delete on public.services for delete to authenticated using (public.is_salon_manager(salon_id));

drop policy if exists clients_member_select on public.clients;
drop policy if exists clients_member_insert on public.clients;
drop policy if exists clients_member_update on public.clients;
drop policy if exists clients_manager_delete on public.clients;
create policy clients_member_select on public.clients for select to authenticated using (public.is_salon_member(salon_id));
create policy clients_member_insert on public.clients for insert to authenticated with check (public.is_salon_member(salon_id));
create policy clients_member_update on public.clients for update to authenticated using (public.is_salon_member(salon_id)) with check (public.is_salon_member(salon_id));
create policy clients_manager_delete on public.clients for delete to authenticated using (public.is_salon_manager(salon_id));

drop policy if exists appointments_visible_select on public.appointments;
drop policy if exists appointments_visible_insert on public.appointments;
drop policy if exists appointments_visible_update on public.appointments;
drop policy if exists appointments_visible_delete on public.appointments;
create policy appointments_visible_select on public.appointments for select to authenticated using (
  public.is_salon_manager(salon_id) or employee_id = public.my_member_id(salon_id)
);
create policy appointments_visible_insert on public.appointments for insert to authenticated with check (
  public.is_salon_manager(salon_id) or employee_id = public.my_member_id(salon_id)
);
create policy appointments_visible_update on public.appointments for update to authenticated using (
  public.is_salon_manager(salon_id) or employee_id = public.my_member_id(salon_id)
) with check (
  public.is_salon_manager(salon_id) or employee_id = public.my_member_id(salon_id)
);
create policy appointments_visible_delete on public.appointments for delete to authenticated using (
  public.is_salon_manager(salon_id) or employee_id = public.my_member_id(salon_id)
);

drop policy if exists visits_member_select on public.visits;
drop policy if exists visits_visible_insert on public.visits;
drop policy if exists visits_visible_update on public.visits;
drop policy if exists visits_visible_delete on public.visits;
create policy visits_member_select on public.visits for select to authenticated using (public.is_salon_member(salon_id));
create policy visits_visible_insert on public.visits for insert to authenticated with check (
  public.is_salon_manager(salon_id) or employee_id = public.my_member_id(salon_id)
);
create policy visits_visible_update on public.visits for update to authenticated using (
  public.is_salon_manager(salon_id) or employee_id = public.my_member_id(salon_id)
) with check (
  public.is_salon_manager(salon_id) or employee_id = public.my_member_id(salon_id)
);
create policy visits_visible_delete on public.visits for delete to authenticated using (
  public.is_salon_manager(salon_id) or employee_id = public.my_member_id(salon_id)
);

drop policy if exists products_member_select on public.products;
drop policy if exists products_member_insert on public.products;
drop policy if exists products_member_update on public.products;
drop policy if exists products_manager_delete on public.products;
create policy products_member_select on public.products for select to authenticated using (public.is_salon_member(salon_id));
create policy products_member_insert on public.products for insert to authenticated with check (public.is_salon_member(salon_id));
create policy products_member_update on public.products for update to authenticated using (public.is_salon_member(salon_id)) with check (public.is_salon_member(salon_id));
create policy products_manager_delete on public.products for delete to authenticated using (public.is_salon_manager(salon_id));

drop policy if exists stock_member_select on public.stock_movements;
create policy stock_member_select on public.stock_movements for select to authenticated using (public.is_salon_member(salon_id));
-- No direct INSERT/UPDATE/DELETE policy: mutations go through record_stock_movement().

drop policy if exists invites_manager_select on public.salons_invites;
create policy invites_manager_select on public.salons_invites for select to authenticated using (public.is_salon_manager(salon_id));
-- Invite creation/acceptance goes through SECURITY DEFINER functions.

-- Realtime: safe to run more than once.
do $$
begin
  if exists(select 1 from pg_publication where pubname='supabase_realtime') then
    if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='appointments') then alter publication supabase_realtime add table public.appointments; end if;
    if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='clients') then alter publication supabase_realtime add table public.clients; end if;
    if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='visits') then alter publication supabase_realtime add table public.visits; end if;
    if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='products') then alter publication supabase_realtime add table public.products; end if;
  end if;
end $$;
