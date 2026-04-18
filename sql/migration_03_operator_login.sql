-- ============================================================
-- Миграция 03: функция входа операторов
-- Запустить в Supabase SQL Editor
-- ============================================================
--
-- Функция принимает логин + пароль, хеширует пароль SHA-256 (так же,
-- как это делает фронт перед записью), сравнивает с password_hash в
-- таблице operators. Возвращает id и name, если совпало и оператор
-- активен. Иначе — пустой результат.
--
-- SECURITY DEFINER нужен, чтобы функция имела доступ к таблице
-- operators (которая закрыта от анонов RLS). Сама функция НЕ
-- возвращает password_hash наружу ни при каких условиях.

create extension if not exists pgcrypto;

create or replace function operator_login(p_login text, p_password text)
returns table(id uuid, name text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_name text;
  v_hash text;
  v_active boolean;
begin
  select o.id, o.name, o.password_hash, o.is_active
    into v_id, v_name, v_hash, v_active
    from operators o
    where lower(o.login) = lower(p_login);

  if v_id is null then return; end if;
  if not v_active then return; end if;
  if v_hash is distinct from encode(digest(p_password, 'sha256'), 'hex') then return; end if;

  return query select v_id, v_name;
end;
$$;

-- Разрешить анонам и авторизованным вызывать эту функцию
grant execute on function operator_login(text, text) to anon, authenticated;
