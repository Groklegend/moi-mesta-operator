-- ============================================================
-- Миграция 10: «Подключение компании» (ТЗ Форма подключения компании)
-- ============================================================
-- Главная функция кабинета продажника: пятишаговый мастер с сохранением
-- черновика. Создаёт таблицу applications, application_messages, бакет
-- application-files в Supabase Storage и категорию «Другое» (если ещё нет).

-- ---------- Категория «Другое» (нужна по ТЗ §1) ----------
insert into public.categories (name, icon, sort_order)
select 'Другое', '📦', 999
where not exists (select 1 from public.categories where name = 'Другое');

-- ---------- Таблица applications ----------
create table if not exists public.applications (
  id              uuid primary key default gen_random_uuid(),
  seller_id       uuid not null references auth.users(id) on delete cascade,
  -- Жизненный цикл по ТЗ §11: draft → new → in_progress → images_pending →
  -- text_pending → creating_cabinet → ready → launched.
  status          text not null default 'draft' check (status in (
    'draft','new','in_progress','images_pending','text_pending',
    'creating_cabinet','ready','launched'
  )),

  -- Шаг 1: О компании
  company_name    text,
  category_id     uuid references public.categories(id) on delete set null,
  logo_url        text,
  style_photos    jsonb default '[]'::jsonb,
  style_desc      text,
  short_desc      text,
  full_desc       text,

  -- Шаг 2: Реквизиты
  inn             text,
  kpp             text,
  legal_name      text,
  ogrn            text,
  legal_address   text,
  signer_name     text,
  signer_position text,
  bank_account    text,
  bank_bik        text,
  bank_corr       text,
  bank_name       text,

  -- Шаг 3: Контакты
  website         text,
  telegram        text,
  max_channel     text,
  instagram       text,
  vk              text,
  customer_phone  text,
  lpr_name        text,
  lpr_phone       text,
  marketer_name   text,
  marketer_phone  text,

  -- Шаг 4: Филиалы (массив объектов { address, lat?, lon? })
  branches        jsonb default '[]'::jsonb,

  -- Шаг 5: Программа лояльности
  loyalty         jsonb,
  conditions      text,

  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  submitted_at    timestamptz
);

create index if not exists idx_applications_seller   on public.applications (seller_id, created_at desc);
create index if not exists idx_applications_status   on public.applications (status);
create index if not exists idx_applications_created  on public.applications (created_at desc);

drop trigger if exists applications_set_updated_at on public.applications;
create trigger applications_set_updated_at
  before update on public.applications
  for each row execute function public.set_updated_at();

-- ---------- Таблица application_messages (для метода Гари POST :id/messages) ----------
create table if not exists public.application_messages (
  id             uuid primary key default gen_random_uuid(),
  application_id uuid not null references public.applications(id) on delete cascade,
  -- author: 'seller' или 'gary'. Сообщения от Гари показываются продажнику.
  author         text not null check (author in ('seller','gary','system')),
  body           text not null,
  created_at     timestamptz not null default now()
);
create index if not exists idx_app_messages_app on public.application_messages (application_id, created_at);

-- ---------- RLS на applications ----------
alter table public.applications enable row level security;

drop policy if exists "apps seller read"  on public.applications;
drop policy if exists "apps seller write" on public.applications;
drop policy if exists "apps admin read"   on public.applications;

-- Продажник видит/правит только свои заявки.
create policy "apps seller read"
  on public.applications for select
  to authenticated
  using (seller_id = auth.uid());

create policy "apps seller write"
  on public.applications for all
  to authenticated
  using (seller_id = auth.uid())
  with check (seller_id = auth.uid());

-- Админ видит все заявки.
create policy "apps admin read"
  on public.applications for select
  to authenticated
  using (public.user_has_role('admin'));

-- ---------- RLS на application_messages ----------
alter table public.application_messages enable row level security;

drop policy if exists "appmsg seller read"   on public.application_messages;
drop policy if exists "appmsg seller insert" on public.application_messages;
drop policy if exists "appmsg admin read"    on public.application_messages;

-- Продажник видит сообщения по своим заявкам.
create policy "appmsg seller read"
  on public.application_messages for select
  to authenticated
  using (
    exists (select 1 from public.applications a
            where a.id = application_id and a.seller_id = auth.uid())
  );

-- Продажник может писать свои сообщения (author='seller').
create policy "appmsg seller insert"
  on public.application_messages for insert
  to authenticated
  with check (
    author = 'seller' and exists (
      select 1 from public.applications a
      where a.id = application_id and a.seller_id = auth.uid()
    )
  );

-- Админ читает все.
create policy "appmsg admin read"
  on public.application_messages for select
  to authenticated
  using (public.user_has_role('admin'));

-- ---------- Storage bucket: application-files ----------
-- Логотипы и фото стиля. Публичный read (как category-images), запись —
-- только в свою папку (seller_id/...).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'application-files',
  'application-files',
  true,
  5242880, -- 5 MB по ТЗ §1
  array['image/jpeg','image/png','image/webp']
)
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- RLS на storage.objects для bucket'а application-files.
drop policy if exists "appfiles read all"  on storage.objects;
drop policy if exists "appfiles seller upload" on storage.objects;
drop policy if exists "appfiles seller delete" on storage.objects;

-- Публичное чтение (Гари и продажник тянут картинки по public URL).
create policy "appfiles read all"
  on storage.objects for select
  to anon, authenticated
  using (bucket_id = 'application-files');

-- Загружать может авторизованный — только в свою папку <auth.uid()>/...
create policy "appfiles seller upload"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'application-files'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "appfiles seller delete"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'application-files'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- ---------- Готово ----------
-- После выполнения проверь:
--   select count(*) from applications;             -- 0
--   select count(*) from application_messages;     -- 0
--   select id from storage.buckets where id='application-files';
