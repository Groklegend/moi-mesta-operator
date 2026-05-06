-- ============================================================
-- Миграция 16: Шаг 2 «Интеграция» в форме подключения компании
-- ============================================================
-- Добавляет JSONB-колонку integration в applications. Структура:
--   {
--     "required": "yes" | "no" | null,         -- требуется ли интеграция
--     "presets": { "1С": "8.3", "iiko": "...", -- ключ = название преднастроенной
--                  "R-Keeper": "...", "Эвотор": "..." }, -- системы; значение = версия.
--     "custom": [{ "name": "MyCRM", "version": "v1.2" }], -- свои системы
--     "when": "before_test" | "after_test" | null         -- когда интегрировать
--   }
-- Если required != 'yes', остальные поля игнорируются.

alter table public.applications
  add column if not exists integration jsonb not null default '{}'::jsonb;

-- ---------- Готово ----------
-- Проверка:
--   select id, integration from applications limit 1;
