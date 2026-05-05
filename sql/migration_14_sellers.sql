-- ============================================================
-- Миграция 14: таблица менеджеров (продажников)
-- Зеркало таблицы operators. Логин + пароль (plain), управляется
-- из кабинета коммерческого директора (commercial.html → Менеджеры).
-- Запустить в Supabase SQL Editor.
-- ============================================================

create table if not exists sellers (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  login       text not null unique,
  password    text,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists sellers_login_idx on sellers (login);

drop trigger if exists sellers_set_updated_at on sellers;
create trigger sellers_set_updated_at
  before update on sellers
  for each row execute function set_updated_at();

-- RLS: только authenticated (админ/коммерческий директор) видит и меняет.
alter table sellers enable row level security;

drop policy if exists "auth manage sellers" on sellers;
create policy "auth manage sellers"
  on sellers
  for all
  to authenticated
  using (true)
  with check (true);

-- Функция входа менеджера — параллельно с operator_login.
create or replace function seller_login(p_login text, p_password text)
returns table(id uuid, name text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid; v_name text; v_pw text; v_active boolean;
begin
  select s.id, s.name, s.password, s.is_active
    into v_id, v_name, v_pw, v_active
    from sellers s
    where lower(s.login) = lower(p_login);

  if v_id is null then return; end if;
  if not v_active then return; end if;
  if v_pw is distinct from p_password then return; end if;

  return query select v_id, v_name;
end;
$$;

grant execute on function seller_login(text, text) to anon, authenticated;
