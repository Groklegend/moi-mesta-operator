-- ============================================================
-- Миграция 12: роль «Коммерческий директор» — RLS на operators
-- ============================================================
-- По задаче: управление операторами и статистика по продажникам/операторам
-- переезжают из админки в кабинет коммерческого директора.
-- Роль `commercial` хранится в массиве public.users.roles (никаких новых
-- колонок не нужно).
--
-- Здесь ужесточаем RLS на public.operators: полный доступ имеют только
-- 'admin' и 'commercial'. Остальные авторизованные (продажник, маркетолог)
-- не должны видеть и трогать таблицу operators напрямую.
-- Для входа оператор использует SECURITY DEFINER-функцию `operator_login`
-- (минует RLS) — это поведение не меняем.

-- ---------- public.operators ----------
drop policy if exists "admins manage operators" on public.operators;
drop policy if exists "commercial admin manage operators" on public.operators;

create policy "commercial admin manage operators"
  on public.operators
  for all
  to authenticated
  using (public.user_has_role('admin') or public.user_has_role('commercial'))
  with check (public.user_has_role('admin') or public.user_has_role('commercial'));

-- ---------- public.seller_daily_reports ----------
-- Чтение для коммерческого директора (раньше было только admin + сам seller).
drop policy if exists "commercial read sellers" on public.seller_daily_reports;
create policy "commercial read sellers"
  on public.seller_daily_reports for select
  to authenticated
  using (public.user_has_role('commercial'));

-- ---------- public.users ----------
-- Коммерческому нужен select из public.users, чтобы выводить ФИО продажников
-- в сводной таблице. Раньше политики были «self read» + «admin read» — добавляю.
drop policy if exists "users commercial read" on public.users;
create policy "users commercial read"
  on public.users for select
  to authenticated
  using (public.user_has_role('commercial'));

-- ---------- public.stats (события возражений) ----------
-- Для статистики операторов коммерческому нужен select.
-- Существующая «auth read stats» уже разрешает любому authenticated читать —
-- так что оставляем как есть (commercial авторизован, проходит).

-- ---------- Готово ----------
-- Проверка:
--   select polname, polroles::regrole[], pg_get_expr(polqual, polrelid)
--   from pg_policy where polrelid = 'public.operators'::regclass;
