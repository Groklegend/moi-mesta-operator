-- ============================================================
-- Миграция 05: таблица «Мотивация» — ежедневные показатели оператора
-- Запустить в Supabase SQL Editor (целиком).
-- ============================================================
-- Каждая строка — один день одного оператора. Формулы пока считает
-- фронт (или оператор вручную). Цены/суммы — numeric, количества — int.
-- Уникальность (operator_id, entry_date) позволяет upsert по ключу.

create table if not exists motivation_entries (
  id                       uuid primary key default gen_random_uuid(),
  operator_id              uuid not null references operators(id) on delete cascade,
  entry_date               date not null,

  -- Звонки исходящие
  calls_out_qty            int,

  -- Звонки состоявшиеся
  calls_done_qty           int,
  calls_done_price         numeric,
  calls_done_sum           numeric,

  -- Выход на ЛПР
  lpr_qty                  int,
  lpr_price                numeric,
  lpr_sum                  numeric,

  -- Встреч назначено
  meetings_scheduled_qty   int,

  -- Встречи состоявшиеся
  meetings_done_qty        int,
  meetings_done_price      numeric,
  meetings_done_sum        numeric,

  -- Запустили Тест
  tests_qty                int,

  -- Договор заключён
  contracts_qty            int,
  contracts_price          numeric,
  contracts_sum            numeric,

  -- Итого (пока пишем вручную; формулы — позже)
  total                    numeric,

  updated_at               timestamptz not null default now(),

  unique (operator_id, entry_date)
);

create index if not exists motivation_entries_op_date_idx
  on motivation_entries (operator_id, entry_date desc);

-- авто-обновление updated_at
drop trigger if exists motivation_entries_set_updated_at on motivation_entries;
create trigger motivation_entries_set_updated_at
  before update on motivation_entries
  for each row execute function set_updated_at();

-- RLS
alter table motivation_entries enable row level security;

-- Пока по той же модели, что и stats: операторы заходят как anon,
-- пишут/читают по operator_id (клиентская фильтрация). Админ (authenticated)
-- имеет полный доступ для сводки.
drop policy if exists "public rw motivation" on motivation_entries;
create policy "public rw motivation"
  on motivation_entries
  for all
  to anon, authenticated
  using (true)
  with check (true);
