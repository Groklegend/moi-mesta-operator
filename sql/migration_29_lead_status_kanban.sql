-- ============================================================
-- Миграция 29: статусы лидов под канбан-колонки «Мои лиды»
-- ============================================================
-- Канбан в seller-leads.js и operator-leads.js имеет 4 «рабочих» колонки:
--   meeting_scheduled  — Назначенная встреча (дефолт при создании)
--   meeting_confirmed  — Подтверждённая встреча
--   meeting_failed     — Не состоялась встреча
--   decision_pending   — Принимает решение
-- + псевдо-колонка «Все», которая показывает любой лид независимо от статуса
-- (в неё нельзя перетащить — это сводка).
--
-- Расширяем CHECK новыми значениями. Старые ('new','contacted',
-- 'meeting_done','won','lost') оставляем в списке, чтобы не падать на
-- легаси-данных, но 'new' и 'contacted' нормализуем к 'meeting_scheduled'
-- — карточки будут в первой колонке, а не пропадут из канбана.

alter table public.leads
  drop constraint if exists leads_status_check;

alter table public.leads
  alter column status set default 'meeting_scheduled';

update public.leads
  set status = 'meeting_scheduled'
  where status in ('new', 'contacted') or status is null;

alter table public.leads
  add constraint leads_status_check
  check (status in (
    'meeting_scheduled',
    'meeting_confirmed',
    'meeting_failed',
    'decision_pending',
    -- legacy (не используются в новом UI, но не падаем на старых записях):
    'meeting_done', 'won', 'lost'
  ));
