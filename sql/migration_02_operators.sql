-- ============================================================
-- Миграция 02: таблица операторов
-- Запустить в Supabase SQL Editor (Database → SQL Editor → New query)
-- ============================================================

create table if not exists operators (
  id             uuid primary key default gen_random_uuid(),
  name           text not null,
  login          text not null unique,
  password_hash  text not null,
  is_active      boolean not null default true,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create index if not exists operators_login_idx on operators (login);

-- авто-обновление updated_at
create or replace function set_updated_at() returns trigger as $$
begin new.updated_at = now(); return new; end;
$$ language plpgsql;

drop trigger if exists operators_set_updated_at on operators;
create trigger operators_set_updated_at
  before update on operators
  for each row execute function set_updated_at();

-- RLS: только авторизованные (админ) могут читать и менять список
alter table operators enable row level security;

drop policy if exists "admins manage operators" on operators;
create policy "admins manage operators"
  on operators
  for all
  to authenticated
  using (true)
  with check (true);

-- Анонам (в т.ч. будущей странице входа оператора) — никакого SELECT.
-- Вход операторов позже будем делать через Postgres-функцию (SECURITY DEFINER),
-- которая вернёт только true/false + id, а password_hash наружу не отдаст.
