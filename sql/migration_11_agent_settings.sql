-- ============================================================
-- Миграция 11: «Настройки Гари» — раздел админки (ТЗ §5.3, §5.7)
-- ============================================================
-- Хранилище для:
--   • расписания процессов Гари (agent_processes)
--   • плоских настроек: лимит бюджета, URL вебхуков (agent_settings KV)
--   • тем для поиска статей (agent_topics)
--   • ленты сообщений от Гари админу (agent_messages, ТЗ §5.7)
--
-- Сервисные токены (service_tokens) уже созданы в миграции 07 —
-- здесь ничего не трогаем, кроме UI-привязки.

-- ---------- agent_processes ----------
create table if not exists public.agent_processes (
  id            uuid primary key default gen_random_uuid(),
  slug          text not null unique,
  label         text not null,
  description   text default '',
  schedule_cron text default '',          -- cron-формат, например "0 6 * * *"
  enabled       boolean not null default true,
  last_run_at   timestamptz,
  last_status   text,                     -- 'ok' | 'error' | null
  sort_order    integer not null default 0,
  updated_at    timestamptz not null default now()
);
create index if not exists idx_agent_processes_sort on public.agent_processes (sort_order);

drop trigger if exists agent_processes_set_updated_at on public.agent_processes;
create trigger agent_processes_set_updated_at
  before update on public.agent_processes
  for each row execute function public.set_updated_at();

alter table public.agent_processes enable row level security;

drop policy if exists "agent_processes admin all" on public.agent_processes;
drop policy if exists "agent_processes service read" on public.agent_processes;

-- Только админ через UI; Гари читает через service_role (минует RLS).
create policy "agent_processes admin all"
  on public.agent_processes for all
  to authenticated
  using (public.user_has_role('admin'))
  with check (public.user_has_role('admin'));

-- Сид: 6 процессов из ТЗ §5.3 (если ещё нет).
insert into public.agent_processes (slug, label, description, schedule_cron, enabled, sort_order) values
  ('articles_digest',   'Дайджест статей',     'Поиск свежих статей по темам и формирование дайджеста.', '0 6 * * *',  true, 10),
  ('companies_pipeline','Конвейер компаний',   'Обработка новых заявок продажников: картинки, тексты, кабинет.', '*/15 * * * *', true, 20),
  ('calls_review',      'Разбор звонков',      'Расшифровка и анализ звонков операторов.', '0 22 * * *', true, 30),
  ('data_collection',   'Сбор данных',         'Сбор внешних данных для аналитики.', '0 4 * * *',  true, 40),
  ('analytics',         'Аналитика',           'Сводные отчёты и метрики команды.', '0 7 * * 1',  true, 50),
  ('backup',            'Бэкап',               'Резервная копия БД Хаба в Google Drive.', '0 3 * * *',  true, 60)
on conflict (slug) do nothing;

-- ---------- agent_settings (key/value) ----------
create table if not exists public.agent_settings (
  key        text primary key,
  value      jsonb,
  updated_at timestamptz not null default now()
);

drop trigger if exists agent_settings_set_updated_at on public.agent_settings;
create trigger agent_settings_set_updated_at
  before update on public.agent_settings
  for each row execute function public.set_updated_at();

alter table public.agent_settings enable row level security;

drop policy if exists "agent_settings admin all" on public.agent_settings;
create policy "agent_settings admin all"
  on public.agent_settings for all
  to authenticated
  using (public.user_has_role('admin'))
  with check (public.user_has_role('admin'));

-- Сид: дефолтные ключи (если нет).
insert into public.agent_settings (key, value) values
  ('monthly_ai_budget_rub', '50000'::jsonb),
  ('webhook_new_application',     '""'::jsonb),
  ('webhook_marketing_decision',  '""'::jsonb),
  ('webhook_settings_changed',    '""'::jsonb)
on conflict (key) do nothing;

-- ---------- agent_topics ----------
create table if not exists public.agent_topics (
  id         uuid primary key default gen_random_uuid(),
  topic      text not null,
  created_at timestamptz not null default now(),
  unique (topic)
);

alter table public.agent_topics enable row level security;

drop policy if exists "agent_topics admin all" on public.agent_topics;
create policy "agent_topics admin all"
  on public.agent_topics for all
  to authenticated
  using (public.user_has_role('admin'))
  with check (public.user_has_role('admin'));

-- ---------- agent_messages (лента «Сообщения от Гари», ТЗ §5.7) ----------
create table if not exists public.agent_messages (
  id         uuid primary key default gen_random_uuid(),
  level      text not null default 'info' check (level in ('info','success','warning','error')),
  title      text not null,
  body       text,
  metadata   jsonb,
  is_read    boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists idx_agent_messages_created on public.agent_messages (created_at desc);
create index if not exists idx_agent_messages_unread  on public.agent_messages (is_read) where is_read = false;

alter table public.agent_messages enable row level security;

drop policy if exists "agent_messages admin all" on public.agent_messages;
create policy "agent_messages admin all"
  on public.agent_messages for all
  to authenticated
  using (public.user_has_role('admin'))
  with check (public.user_has_role('admin'));
-- Гари пишет через service_role.

-- ---------- Несколько демо-сообщений, чтобы лента не была пустой ----------
insert into public.agent_messages (level, title, body)
select 'info', 'Гари запущен', 'Платформа Хаба подключена. Жду новых заявок.'
where not exists (select 1 from public.agent_messages);

-- ---------- Готово ----------
-- select * from agent_processes order by sort_order;
-- select * from agent_settings;
-- select * from agent_topics;
-- select * from agent_messages order by created_at desc limit 20;
