-- ============================================================
-- Миграция 25: get_busy_slots возвращает label и source
-- ============================================================
-- В правой панели «Заявки Плюс» оператор видит занятые слоты с
-- подписью — название компании (для лидов) или комментарий (для
-- ручных блокировок менеджера). source различает откуда слот пришёл,
-- чтобы UI мог по-разному стилизовать.

drop function if exists public.get_busy_slots(date);

create function public.get_busy_slots(d date)
returns table(
  manager_id uuid,
  meeting_at timestamptz,
  duration_minutes int,
  label text,
  source text
)
language sql
security definer
set search_path = public
as $$
  select manager_id, meeting_at, 60::int as duration_minutes,
         company_name as label, 'lead'::text as source
  from public.leads
  where meeting_at is not null
    and (meeting_at at time zone 'Europe/Moscow')::date = d
  union all
  select manager_id, busy_at, coalesce(duration_minutes, 60)::int,
         comment as label, 'block'::text as source
  from public.manager_busy_slots
  where (busy_at at time zone 'Europe/Moscow')::date = d
$$;

grant execute on function public.get_busy_slots(date) to authenticated;
