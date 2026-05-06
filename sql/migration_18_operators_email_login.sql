-- ============================================================
-- Миграция 18: operators.login и sellers.login = email
-- ============================================================
-- После миграции на Хаб (Supabase Auth) реальный логин — это email.
-- Legacy-таблицы operators/sellers использовались до миграции с короткими
-- логинами (типа `elena`), и в кабинете коммерческого директора виден
-- именно этот короткий логин — а оператор реально входит через email.
--
-- Чтобы убрать рассинхрон, делаем login = email. Для существующих
-- записей без `@` дописываем `@operators.moi-mesta.local`.
-- Все новые операторы создаются через Worker (POST /api/v1/commercial/users),
-- который сразу заводит auth.users с этим email + кладёт в operators login=email.

update public.operators
set login = login || '@operators.moi-mesta.local',
    updated_at = now()
where login is not null and login !~ '@';

-- ---------- sellers (если такая таблица есть) ----------
-- В sellers логины уже email (там input type=email), но на всякий случай.
do $$
begin
  if exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'sellers'
  ) then
    update public.sellers
    set login = login || '@operators.moi-mesta.local',
        updated_at = now()
    where login is not null and login !~ '@';
  end if;
end $$;

-- ---------- Готово ----------
-- Проверка:
--   select id, name, login, password from operators order by created_at desc;
--   select id, name, login, password from sellers order by created_at desc;
