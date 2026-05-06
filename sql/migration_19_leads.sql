-- ============================================================
-- Миграция 19: таблица leads (лиды от операторов холодных звонков)
-- ============================================================
-- Оператор в кабинете «Заявка Плюс» создаёт карточку клиента: имя
-- компании, город, контакты, ЛПР, программа лояльности, дата/адрес
-- встречи, и привязывает к менеджеру (manager_id). Менеджер видит
-- свои назначенные лиды в разделе «Мои лиды» (seller.html).
--
-- Поля pitch/demo_intro/recommendations/operator_call заполняются
-- позже агентом Гари (когда он подключится через /api/v1/*) — на
-- старте остаются null. UI устойчив к их отсутствию.
--
-- До этой миграции «Мои лиды» работали на моках js/leads-data.js,
-- который оставляем для demo.html (публичная демо-страница клиенту).

create table if not exists public.leads (
  id uuid primary key default gen_random_uuid(),

  -- Заполняется оператором
  company_name      text not null,
  city              text,
  phone             text,
  caller_phone      text,
  lpr_name          text,
  has_loyalty       boolean default false,
  loyalty_description text,
  website           text,
  telegram          text,
  meeting_at        timestamptz,
  meeting_address   text,
  comment           text,

  -- Заполняется Гари / менеджером позже
  pitch             jsonb,
  demo_intro        jsonb,
  recommendations   jsonb,
  operator_call     jsonb,

  -- Связи
  operator_id       uuid references public.users(id) on delete set null,
  manager_id        uuid references public.users(id) on delete set null,

  status            text default 'new'
                    check (status in ('new','contacted','meeting_scheduled',
                                      'meeting_done','won','lost')),

  created_at        timestamptz default now(),
  updated_at        timestamptz default now()
);

create index if not exists leads_manager_idx  on public.leads(manager_id);
create index if not exists leads_operator_idx on public.leads(operator_id);
create index if not exists leads_meeting_idx  on public.leads(meeting_at);

-- Триггер обновления updated_at
create or replace function public.tg_leads_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists leads_updated_at_trg on public.leads;
create trigger leads_updated_at_trg
  before update on public.leads
  for each row execute function public.tg_leads_updated_at();

-- ---------- RLS ----------
alter table public.leads enable row level security;

-- Видеть может: автор-оператор, назначенный менеджер, admin или commercial.
drop policy if exists "leads_select" on public.leads;
create policy "leads_select" on public.leads for select
  using (
    operator_id = auth.uid()
    or manager_id = auth.uid()
    or exists (
      select 1 from public.users u
      where u.id = auth.uid()
        and (u.roles @> array['admin']::text[] or u.roles @> array['commercial']::text[])
    )
  );

-- Создавать: оператор для себя (operator_id = auth.uid()), admin/commercial — кому угодно.
drop policy if exists "leads_insert" on public.leads;
create policy "leads_insert" on public.leads for insert
  with check (
    operator_id = auth.uid()
    or exists (
      select 1 from public.users u
      where u.id = auth.uid()
        and (u.roles @> array['admin']::text[] or u.roles @> array['commercial']::text[])
    )
  );

-- Обновлять: автор-оператор (свои), назначенный менеджер (свои), admin/commercial — все.
drop policy if exists "leads_update" on public.leads;
create policy "leads_update" on public.leads for update
  using (
    operator_id = auth.uid()
    or manager_id = auth.uid()
    or exists (
      select 1 from public.users u
      where u.id = auth.uid()
        and (u.roles @> array['admin']::text[] or u.roles @> array['commercial']::text[])
    )
  );

-- Удалять — только admin/commercial.
drop policy if exists "leads_delete" on public.leads;
create policy "leads_delete" on public.leads for delete
  using (
    exists (
      select 1 from public.users u
      where u.id = auth.uid()
        and (u.roles @> array['admin']::text[] or u.roles @> array['commercial']::text[])
    )
  );

-- ---------- Готово ----------
-- Проверка:
--   select count(*) from public.leads;
--   select tablename, policyname from pg_policies where tablename='leads';
