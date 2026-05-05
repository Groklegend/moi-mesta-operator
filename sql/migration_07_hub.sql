-- ============================================================
-- Миграция 07: Каркас Хаба — users (с ролями), audit_log, notifications, service_tokens
-- Запустить в Supabase SQL Editor целиком.
-- ============================================================
-- По ТЗ §3-§7. Расширяет проект от «сайта оператора» до «Хаба» с 4 ролями.
-- Не трогает существующие таблицы (categories, objections, operators, motivation_entries и т.д.) — они продолжают работать как есть.
--
-- Архитектура авторизации:
--   • Supabase Auth (auth.users) хранит email/пароль/сессию.
--   • public.users зеркалит auth.users и хранит роли (массив) + статус.
--   • Триггер on_auth_user_created автоматически создаёт строку в public.users
--     при добавлении нового auth-пользователя (через invite или signup).
--   • Сервис-роль (Гари + админка через service_role) обходит RLS и делает что угодно.

-- ---------- Таблица users ----------

create table if not exists public.users (
  id                  uuid primary key references auth.users(id) on delete cascade,
  email               text not null unique,
  full_name           text default '',
  roles               text[] not null default '{}',
  status              text not null default 'active' check (status in ('active', 'disabled')),
  -- Заготовка под 2FA на будущее (ТЗ §7.3) — логику не реализуем сейчас.
  two_factor_enabled  boolean not null default false,
  two_factor_secret   text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create index if not exists idx_users_roles on public.users using gin (roles);
create index if not exists idx_users_status on public.users (status);

-- авто-updated_at (функция set_updated_at уже есть из миграции 05)
drop trigger if exists users_set_updated_at on public.users;
create trigger users_set_updated_at
  before update on public.users
  for each row execute function public.set_updated_at();

-- ---------- Helper-функция: проверка роли текущего пользователя ----------

-- Возвращает true, если у текущего auth.uid() в public.users есть указанная роль и статус active.
-- SECURITY DEFINER нужен, чтобы функция могла читать public.users в обход её RLS
-- (иначе при включённом RLS получим бесконечную рекурсию).
create or replace function public.user_has_role(role_name text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select role_name = any(u.roles) and u.status = 'active'
       from public.users u
       where u.id = auth.uid()),
    false
  )
$$;

grant execute on function public.user_has_role(text) to anon, authenticated;

-- ---------- Триггер: новая запись в auth.users → авто-строка в public.users ----------

create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.users (id, email, full_name, roles, status)
  values (
    new.id,
    coalesce(new.email, ''),
    coalesce(new.raw_user_meta_data ->> 'full_name', ''),
    -- Если админ при инвайте передал roles в user_metadata, разворачиваем csv в массив.
    -- Если не передал — пустой массив, админ потом проставит вручную в админке.
    case
      when new.raw_user_meta_data ? 'roles'
        then string_to_array(new.raw_user_meta_data ->> 'roles', ',')
      else '{}'::text[]
    end,
    'active'
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_auth_user();

-- ---------- Backfill: для существующих auth.users создать строки в public.users ----------
-- Сейчас в проекте 1 живой auth-пользователь — eklegendcity@gmail.com.
-- Делаем его админом по умолчанию (он же владелец проекта).

insert into public.users (id, email, full_name, roles, status)
select au.id, au.email, '', array['admin']::text[], 'active'
from auth.users au
where not exists (select 1 from public.users pu where pu.id = au.id)
on conflict (id) do nothing;

-- ---------- RLS для public.users ----------

alter table public.users enable row level security;

drop policy if exists "users self read"   on public.users;
drop policy if exists "users admin read"  on public.users;
drop policy if exists "users admin write" on public.users;
drop policy if exists "users self update" on public.users;

-- Каждый авторизованный видит свою строку (нужно фронту, чтобы понять свои роли).
create policy "users self read"
  on public.users for select
  to authenticated
  using (id = auth.uid());

-- Админ видит всех пользователей.
create policy "users admin read"
  on public.users for select
  to authenticated
  using (public.user_has_role('admin'));

-- Только админ может добавлять/менять/отключать пользователей.
create policy "users admin write"
  on public.users for all
  to authenticated
  using (public.user_has_role('admin'))
  with check (public.user_has_role('admin'));

-- ---------- Таблица audit_log (ТЗ §7.1) ----------

create table if not exists public.audit_log (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid references public.users(id) on delete set null,
  user_email  text,
  is_agent    boolean not null default false,
  action      text not null,
  target_type text,
  target_id   uuid,
  ip_address  text,
  user_agent  text,
  metadata    jsonb,
  created_at  timestamptz not null default now()
);

create index if not exists idx_audit_log_created on public.audit_log (created_at desc);
create index if not exists idx_audit_log_user on public.audit_log (user_id);
create index if not exists idx_audit_log_action on public.audit_log (action);

alter table public.audit_log enable row level security;

drop policy if exists "audit admin read" on public.audit_log;
drop policy if exists "audit auth insert" on public.audit_log;

-- Читать журнал может только админ.
create policy "audit admin read"
  on public.audit_log for select
  to authenticated
  using (public.user_has_role('admin'));

-- Писать в журнал может любой авторизованный (UI-события). Гари пишет через service_role.
-- Анон может писать только login_failed (см. WHEN-условие).
create policy "audit auth insert"
  on public.audit_log for insert
  to anon, authenticated
  with check (
    -- авторизованный пользователь может писать что угодно про себя
    (auth.uid() is not null and (user_id is null or user_id = auth.uid()))
    -- анон может писать только неудачные попытки входа
    or (auth.uid() is null and action = 'login_failed')
  );

-- ---------- Таблица notifications (ТЗ §9) ----------

create table if not exists public.notifications (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.users(id) on delete cascade,
  title      text not null,
  body       text,
  link       text,
  is_read    boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists idx_notifications_user_unread on public.notifications (user_id, is_read);
create index if not exists idx_notifications_created on public.notifications (created_at desc);

alter table public.notifications enable row level security;

drop policy if exists "notif self read"   on public.notifications;
drop policy if exists "notif self update" on public.notifications;
drop policy if exists "notif admin all"   on public.notifications;

-- Каждый пользователь видит только свои уведомления.
create policy "notif self read"
  on public.notifications for select
  to authenticated
  using (user_id = auth.uid());

-- Помечать прочитанным может только владелец.
create policy "notif self update"
  on public.notifications for update
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- Админ может всё (для системных уведомлений). Гари пишет через service_role.
create policy "notif admin all"
  on public.notifications for all
  to authenticated
  using (public.user_has_role('admin'))
  with check (public.user_has_role('admin'));

-- ---------- Таблица service_tokens (ТЗ §6.1) ----------

create table if not exists public.service_tokens (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  -- token_hash = sha256(plain_token); сам токен показываем один раз при создании и нигде не сохраняем.
  token_hash  text not null unique,
  -- Префикс плейн-токена для отображения в UI (например "hub_a1b2…").
  token_prefix text not null,
  created_by  uuid references public.users(id) on delete set null,
  created_at  timestamptz not null default now(),
  revoked_at  timestamptz,
  last_used_at timestamptz
);

create index if not exists idx_service_tokens_active on public.service_tokens (revoked_at) where revoked_at is null;

alter table public.service_tokens enable row level security;

drop policy if exists "tokens admin all" on public.service_tokens;

-- Только админ. Гари сам не лезет в эту таблицу — Worker проверяет токен через service_role.
create policy "tokens admin all"
  on public.service_tokens for all
  to authenticated
  using (public.user_has_role('admin'))
  with check (public.user_has_role('admin'));

-- ---------- Готово ----------
-- После выполнения проверь, что таблицы появились:
--   select table_name from information_schema.tables
--   where table_schema = 'public'
--     and table_name in ('users','audit_log','notifications','service_tokens');
-- Должно вернуть 4 строки.
