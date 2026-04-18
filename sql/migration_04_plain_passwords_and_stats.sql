-- ============================================================
-- Миграция 04:
--   1) Пароли операторов хранятся в открытом виде, чтобы админ
--      мог их видеть в админ-панели.
--   2) К таблице stats добавляется operator_id — чтобы видеть,
--      кто из операторов что кликал.
-- Запустить в Supabase SQL Editor (целиком).
-- ============================================================

-- ---- 1. Пароли в plain text ----

-- Уронить старую функцию
drop function if exists operator_login(text, text);

-- Новая колонка password (plain). Старая password_hash — удаляется.
alter table operators add column if not exists password text;
alter table operators drop column if exists password_hash;

-- Новая функция входа: сравнивает plain-пароль
create or replace function operator_login(p_login text, p_password text)
returns table(id uuid, name text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid; v_name text; v_pw text; v_active boolean;
begin
  select o.id, o.name, o.password, o.is_active
    into v_id, v_name, v_pw, v_active
    from operators o
    where lower(o.login) = lower(p_login);

  if v_id is null then return; end if;
  if not v_active then return; end if;
  if v_pw is distinct from p_password then return; end if;

  return query select v_id, v_name;
end;
$$;

grant execute on function operator_login(text, text) to anon, authenticated;

-- ---- 2. operator_id в stats ----

alter table stats add column if not exists operator_id uuid
  references operators(id) on delete set null;

create index if not exists stats_operator_id_idx on stats (operator_id);

-- RLS уже разрешает anon INSERT — поле operator_id просто пишется как есть.
