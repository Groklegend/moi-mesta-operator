-- ============================================================
-- Миграция 08: триггер уведомления админам при 3+ login_failed
-- ТЗ §7.1: «При 3+ подряд от одного email — уведомление админу.»
-- ============================================================
-- Простая логика: после каждого insert'а login_failed считаем
-- такие же события за последние 5 минут от того же email.
-- Если >= 3 — пишем уведомление каждому админу. Один раз на серию:
-- если в последние 30 мин уже было такое уведомление по этому email,
-- повторно не шлём (чтобы не флудить).

create or replace function public.notify_admins_on_login_attack()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count int;
  v_recent_alert int;
  v_email text;
begin
  if new.action <> 'login_failed' then return new; end if;
  v_email := coalesce(new.user_email, '');
  if v_email = '' then return new; end if;

  -- Сколько неудачных попыток с этим email за последние 5 минут.
  select count(*) into v_count
    from public.audit_log
    where action = 'login_failed'
      and lower(coalesce(user_email, '')) = lower(v_email)
      and created_at >= (now() - interval '5 minutes');

  if v_count < 3 then return new; end if;

  -- Уже было уведомление по этому email за последние 30 минут? — не дублируем.
  select count(*) into v_recent_alert
    from public.notifications
    where created_at >= (now() - interval '30 minutes')
      and metadata is not null
      and (metadata ->> 'email') = v_email
      and (metadata ->> 'kind') = 'login_attack';

  if v_recent_alert > 0 then return new; end if;

  insert into public.notifications (user_id, title, body, link, metadata)
  select u.id,
         'Подозрительные попытки входа',
         format('С email "%s" — %s неудачных попыток входа за 5 минут.', v_email, v_count),
         '/admin.html#audit',
         jsonb_build_object('kind', 'login_attack', 'email', v_email, 'count', v_count)
    from public.users u
    where 'admin' = any(u.roles) and u.status = 'active';

  return new;
end;
$$;

-- Колонка metadata в notifications — возможно, её ещё нет.
alter table public.notifications add column if not exists metadata jsonb;

drop trigger if exists audit_log_login_attack on public.audit_log;
create trigger audit_log_login_attack
  after insert on public.audit_log
  for each row execute function public.notify_admins_on_login_attack();

-- ---------- Очистка старых записей audit_log (>90 дней) ----------
-- Функция-сборщик мусора. Будем дёргать её из ежедневного cron
-- в Cloudflare Worker (PR-7 / Этап 4) или вручную.

create or replace function public.audit_log_purge_old()
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_deleted int;
begin
  delete from public.audit_log where created_at < (now() - interval '90 days');
  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;

grant execute on function public.audit_log_purge_old() to authenticated;
