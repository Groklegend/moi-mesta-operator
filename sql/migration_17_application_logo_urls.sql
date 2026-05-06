-- ============================================================
-- Миграция 17: Логотип компании — до 10 фото вместо одного
-- ============================================================
-- Поле logo_url (text) сохраняется для обратной совместимости.
-- Новое поле logo_urls (jsonb) — массив URL до 10 элементов.
-- Если logo_urls пуст и logo_url непуст — фронт показывает старое значение.

alter table public.applications
  add column if not exists logo_urls jsonb not null default '[]'::jsonb;

-- ---------- Готово ----------
-- Проверка:
--   select id, logo_url, logo_urls from applications limit 5;
