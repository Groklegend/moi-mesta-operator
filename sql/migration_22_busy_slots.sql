-- ============================================================
-- Миграция 22: RPC get_busy_slots(day) — занятость менеджеров
-- ============================================================
-- В кабинете оператора («Заявка Плюс») справа от формы рисуется
-- расписание менеджеров: какие слоты у них уже заняты на выбранный
-- день. Это нужно, чтобы оператор не назначал встречу в занятое
-- время.
--
-- Прямой select на public.leads оператору закрыт RLS (он видит
-- только свои собственные лиды). Делаем SECURITY DEFINER функцию,
-- которая возвращает ТОЛЬКО manager_id + meeting_at — без контактов,
-- комментариев, ФИО ЛПР и других чувствительных полей. Это безопасно:
-- расписание менеджеров — внутренняя информация компании, и каждый
-- залогиненный оператор имеет право его видеть.
--
-- Часовой пояс Europe/Moscow зашит, потому что вся компания работает
-- в одной зоне; если позже появится мульти-региональная команда —
-- можно вынести в параметр.

create or replace function public.get_busy_slots(d date)
returns table(manager_id uuid, meeting_at timestamptz)
language sql
security definer
set search_path = public
as $$
  select manager_id, meeting_at
  from public.leads
  where meeting_at is not null
    and (meeting_at at time zone 'Europe/Moscow')::date = d
$$;

grant execute on function public.get_busy_slots(date) to authenticated;
