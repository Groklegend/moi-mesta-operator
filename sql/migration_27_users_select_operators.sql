-- ============================================================
-- Миграция 27: менеджер видит имя оператора, создавшего лид
-- ============================================================
-- В seller-leads.js и seller-calendar.js надо показывать менеджеру,
-- кто из операторов поставил ему лид (например «оператор Елена»).
-- По умолчанию RLS на public.users закрывает чужие строки. Открываем
-- узкое окно: любой залогиненный читает строки с ролью 'operator'.
-- Email и ФИО оператора — не секрет внутри компании; зеркальная
-- политика к migration_20 (sellers).

drop policy if exists "users select operators" on public.users;
create policy "users select operators" on public.users for select
  using (roles @> array['operator']::text[]);
