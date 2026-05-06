-- ============================================================
-- Миграция 23: блокировки времени менеджера (manager_busy_slots)
-- ============================================================
-- Менеджер в кабинете «Календарь» (seller.html) сам отмечает занятое
-- время — личные дела, обучение, другие встречи. Это видно оператору
-- в правой панели «Заявка Плюс» как занятый слот, наряду со встречами
-- из таблицы leads.
--
-- Хранение через отдельную таблицу — чтобы блокировка не была лидом
-- и не появлялась в кабинете менеджера в разделе «Мои лиды».
-- duration_minutes на будущее (по умолчанию 60), сейчас в UI не виден.

create table if not exists public.manager_busy_slots (
  id uuid primary key default gen_random_uuid(),
  manager_id uuid not null references public.users(id) on delete cascade,
  busy_at timestamptz not null,
  duration_minutes int default 60,
  comment text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index if not exists manager_busy_slots_mgr_idx on public.manager_busy_slots(manager_id);
create index if not exists manager_busy_slots_at_idx  on public.manager_busy_slots(busy_at);

create or replace function public.tg_manager_busy_slots_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists manager_busy_slots_updated_at_trg on public.manager_busy_slots;
create trigger manager_busy_slots_updated_at_trg
  before update on public.manager_busy_slots
  for each row execute function public.tg_manager_busy_slots_updated_at();

alter table public.manager_busy_slots enable row level security;

-- SELECT: свои + admin/commercial.
drop policy if exists "mbs_select" on public.manager_busy_slots;
create policy "mbs_select" on public.manager_busy_slots for select
  using (
    manager_id = auth.uid()
    or exists (
      select 1 from public.users u
      where u.id = auth.uid()
        and (u.roles @> array['admin']::text[] or u.roles @> array['commercial']::text[])
    )
  );

-- INSERT: только сам менеджер для себя; admin/commercial — кому угодно.
drop policy if exists "mbs_insert" on public.manager_busy_slots;
create policy "mbs_insert" on public.manager_busy_slots for insert
  with check (
    manager_id = auth.uid()
    or exists (
      select 1 from public.users u
      where u.id = auth.uid()
        and (u.roles @> array['admin']::text[] or u.roles @> array['commercial']::text[])
    )
  );

-- UPDATE / DELETE: свои + admin/commercial.
drop policy if exists "mbs_update" on public.manager_busy_slots;
create policy "mbs_update" on public.manager_busy_slots for update
  using (
    manager_id = auth.uid()
    or exists (
      select 1 from public.users u
      where u.id = auth.uid()
        and (u.roles @> array['admin']::text[] or u.roles @> array['commercial']::text[])
    )
  );

drop policy if exists "mbs_delete" on public.manager_busy_slots;
create policy "mbs_delete" on public.manager_busy_slots for delete
  using (
    manager_id = auth.uid()
    or exists (
      select 1 from public.users u
      where u.id = auth.uid()
        and (u.roles @> array['admin']::text[] or u.roles @> array['commercial']::text[])
    )
  );

-- ---------- Расширяем RPC get_busy_slots ----------
-- Сигнатура та же (manager_id, meeting_at) — operator-leads.js менять не
-- надо. UNION ALL: встречи из leads + блокировки из manager_busy_slots.
-- Оператор видит общий список занятости каждого менеджера.

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
  union all
  select manager_id, busy_at as meeting_at
  from public.manager_busy_slots
  where (busy_at at time zone 'Europe/Moscow')::date = d
$$;
