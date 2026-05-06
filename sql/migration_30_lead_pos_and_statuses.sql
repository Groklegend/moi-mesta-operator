-- ============================================================
-- Миграция 30: канбан-расширение — статусы + порядок карточек
-- ============================================================
-- 1) Добавляем два новых статуса для колонок:
--    callback   — Перезвонить
--    reschedule — Назначить новую дату
-- 2) Добавляем числовую колонку lead_pos для ручного перетаскивания
--    карточек внутри колонки и между колонками с сохранением порядка.
--    Сортировка в UI: ORDER BY lead_pos DESC NULLS LAST, created_at DESC.
--    Новый лид → lead_pos = epoch(now()) (всплывает наверх своей колонки).
--    Drag-reorder → midpoint между соседями (без рекалькуляции всех строк).

alter table public.leads
  drop constraint if exists leads_status_check;
alter table public.leads
  add constraint leads_status_check
  check (status in (
    'meeting_scheduled',
    'meeting_confirmed',
    'meeting_failed',
    'decision_pending',
    'callback',
    'reschedule',
    'meeting_done', 'won', 'lost'
  ));

alter table public.leads
  add column if not exists lead_pos double precision;
update public.leads
  set lead_pos = extract(epoch from coalesce(created_at, now()))
  where lead_pos is null;
