-- ============================================================
-- Миграция 26: шаг календаря у каждого менеджера
-- ============================================================
-- Каждый менеджер сам выбирает удобный шаг почасовой сетки
-- (1 час или 1½ часа). Когда оператор смотрит расписание этого
-- менеджера в «Заявка Плюс» → правая панель отображается с тем же
-- шагом, что выбрал сам менеджер. Оператор шаг не меняет.
--
-- Хранение — колонка users.cal_step_minutes (60 | 90). Для смены
-- шага у себя — RPC set_my_cal_step(int): SECURITY DEFINER без
-- расширения политик UPDATE на users (чтобы менеджер не мог трогать
-- свои roles/status через прямой UPDATE).

alter table public.users
  add column if not exists cal_step_minutes int default 60
  check (cal_step_minutes in (60, 90));

create or replace function public.set_my_cal_step(step int)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if step not in (60, 90) then
    raise exception 'cal_step_minutes must be 60 or 90';
  end if;
  update public.users
  set cal_step_minutes = step
  where id = auth.uid();
end;
$$;

grant execute on function public.set_my_cal_step(int) to authenticated;
