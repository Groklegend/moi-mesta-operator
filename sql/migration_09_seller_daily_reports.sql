-- ============================================================
-- Миграция 09: ежедневный отчёт продажника (ТЗ «Форма ежедневный отчёт продажника»)
-- ============================================================
-- 8 числовых колонок воронки + (seller_id, report_date) уникальный.
-- RLS: продажник видит/пишет только свои строки, админ — всё, Гари —
-- через service_role обходит RLS.

create table if not exists public.seller_daily_reports (
  id                  uuid primary key default gen_random_uuid(),
  seller_id           uuid not null references auth.users(id) on delete cascade,
  report_date         date not null,

  meetings_scheduled  integer not null default 0,
  meetings_held       integer not null default 0,
  agreed_to_test      integer not null default 0,
  refused             integer not null default 0,
  thinking            integer not null default 0,
  integration_needed  integer not null default 0,
  launched_on_test    integer not null default 0,
  signed_and_paid     integer not null default 0,

  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),

  unique (seller_id, report_date),
  -- Числа в диапазоне 0..999 по ТЗ.
  check (meetings_scheduled  between 0 and 999),
  check (meetings_held       between 0 and 999),
  check (agreed_to_test      between 0 and 999),
  check (refused             between 0 and 999),
  check (thinking            between 0 and 999),
  check (integration_needed  between 0 and 999),
  check (launched_on_test    between 0 and 999),
  check (signed_and_paid     between 0 and 999)
);

create index if not exists idx_seller_reports_date
  on public.seller_daily_reports (report_date desc);
create index if not exists idx_seller_reports_seller
  on public.seller_daily_reports (seller_id, report_date desc);

drop trigger if exists seller_reports_set_updated_at on public.seller_daily_reports;
create trigger seller_reports_set_updated_at
  before update on public.seller_daily_reports
  for each row execute function public.set_updated_at();

alter table public.seller_daily_reports enable row level security;

drop policy if exists "seller self read"   on public.seller_daily_reports;
drop policy if exists "seller self write"  on public.seller_daily_reports;
drop policy if exists "admin read sellers" on public.seller_daily_reports;

-- Продажник видит и редактирует только свои отчёты.
create policy "seller self read"
  on public.seller_daily_reports for select
  to authenticated
  using (seller_id = auth.uid());

create policy "seller self write"
  on public.seller_daily_reports for all
  to authenticated
  using (seller_id = auth.uid())
  with check (seller_id = auth.uid());

-- Админ видит все отчёты всех продажников.
create policy "admin read sellers"
  on public.seller_daily_reports for select
  to authenticated
  using (public.user_has_role('admin'));
