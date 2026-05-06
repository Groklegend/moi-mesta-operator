-- ============================================================
-- Миграция 24: get_busy_slots возвращает duration_minutes
-- ============================================================
-- Менеджер в календаре указывает диапазон «время с – время до» —
-- оператору нужно видеть полную длительность блокировки, а не только
-- момент начала, иначе он может назначить встречу внутри занятого
-- интервала. Расширяем RPC ещё одним столбцом.
--
-- У встреч из leads длительность пока не хранится — подставляем 60.
-- Если позже появится колонка leads.duration — заменим на coalesce.

drop function if exists public.get_busy_slots(date);

create function public.get_busy_slots(d date)
returns table(manager_id uuid, meeting_at timestamptz, duration_minutes int)
language sql
security definer
set search_path = public
as $$
  select manager_id, meeting_at, 60::int as duration_minutes
  from public.leads
  where meeting_at is not null
    and (meeting_at at time zone 'Europe/Moscow')::date = d
  union all
  select manager_id, busy_at as meeting_at, coalesce(duration_minutes, 60)::int
  from public.manager_busy_slots
  where (busy_at at time zone 'Europe/Moscow')::date = d
$$;

grant execute on function public.get_busy_slots(date) to authenticated;
