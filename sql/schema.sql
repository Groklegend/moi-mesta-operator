-- ============================================================
-- Схема БД для «Мои места» - Сайт-помощник оператору (Версия 1)
-- Выполнить в Supabase SQL Editor один раз
-- ============================================================

-- ---------- Таблицы ----------

create table if not exists categories (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  icon        text default '',
  sort_order  integer default 0,
  created_at  timestamptz default now()
);

create table if not exists objections (
  id          uuid primary key default gen_random_uuid(),
  title       text not null,
  answer      text not null,
  category_id uuid references categories(id) on delete set null,
  is_general  boolean default false,
  keywords    text default '',
  sort_order  integer default 0,
  is_active   boolean default true,
  created_at  timestamptz default now()
);

create table if not exists cheatsheet_blocks (
  id         uuid primary key default gen_random_uuid(),
  title      text not null,
  content    text not null,
  sort_order integer default 0,
  created_at timestamptz default now()
);

create table if not exists documents (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  url         text not null,
  description text,
  sort_order  integer default 0,
  created_at  timestamptz default now()
);

create table if not exists stats (
  id           uuid primary key default gen_random_uuid(),
  event_type   text not null check (event_type in ('objection_click','category_open','search')),
  objection_id uuid references objections(id) on delete set null,
  category_id  uuid references categories(id) on delete set null,
  search_query text,
  created_at   timestamptz default now()
);

create table if not exists objection_comments (
  id           uuid primary key default gen_random_uuid(),
  objection_id uuid references objections(id) on delete cascade,
  comment_text text not null,
  created_at   timestamptz default now()
);
create index if not exists idx_objection_comments_objection on objection_comments(objection_id);
create index if not exists idx_objection_comments_created on objection_comments(created_at desc);

create index if not exists idx_objections_category on objections(category_id);
create index if not exists idx_objections_active on objections(is_active);
create index if not exists idx_stats_created on stats(created_at desc);
create index if not exists idx_stats_type on stats(event_type);

-- ---------- RLS ----------

alter table categories        enable row level security;
alter table objections        enable row level security;
alter table cheatsheet_blocks enable row level security;
alter table documents         enable row level security;
alter table stats             enable row level security;
alter table objection_comments enable row level security;

-- Чтение — публичное (оператору логин не нужен)
drop policy if exists "public read categories"        on categories;
drop policy if exists "public read objections"        on objections;
drop policy if exists "public read cheatsheet"       on cheatsheet_blocks;
drop policy if exists "public read documents"        on documents;

create policy "public read categories"  on categories        for select using (true);
create policy "public read objections"  on objections        for select using (true);
create policy "public read cheatsheet" on cheatsheet_blocks for select using (true);
create policy "public read documents"  on documents         for select using (true);

-- Запись — только авторизованные (админ)
drop policy if exists "auth write categories"  on categories;
drop policy if exists "auth write objections"  on objections;
drop policy if exists "auth write cheatsheet" on cheatsheet_blocks;
drop policy if exists "auth write documents"  on documents;

create policy "auth write categories"  on categories        for all to authenticated using (true) with check (true);
create policy "auth write objections"  on objections        for all to authenticated using (true) with check (true);
create policy "auth write cheatsheet" on cheatsheet_blocks for all to authenticated using (true) with check (true);
create policy "auth write documents"  on documents         for all to authenticated using (true) with check (true);

-- Статистика: оператор может писать (логировать событие), админ — читать
drop policy if exists "public insert stats" on stats;
drop policy if exists "auth read stats"     on stats;
drop policy if exists "auth delete stats"   on stats;

create policy "public insert stats" on stats for insert to anon, authenticated with check (true);
create policy "auth read stats"     on stats for select to authenticated using (true);
create policy "auth delete stats"   on stats for delete to authenticated using (true);

drop policy if exists "public insert comments" on objection_comments;
drop policy if exists "public read comments"   on objection_comments;
drop policy if exists "auth read comments"     on objection_comments;
drop policy if exists "auth delete comments"   on objection_comments;

create policy "public insert comments" on objection_comments for insert to anon, authenticated with check (true);
create policy "public read comments"   on objection_comments for select to anon, authenticated using (true);
create policy "auth delete comments"   on objection_comments for delete to authenticated using (true);

-- ---------- Начальное наполнение (пример — CEO заменит через админку) ----------

insert into categories (name, icon, sort_order) values
  ('Рестораны',       '🍽️', 10),
  ('Стоматологии',    '🦷', 20),
  ('Салоны красоты',  '💇', 30),
  ('Автосервисы',     '🔧', 40)
on conflict do nothing;

insert into objections (title, answer, is_general, keywords, sort_order) values
  ('Дорого',
   'Понимаю вас. Давайте посчитаем: 25 000 рублей за лицензию окупаются за 2–3 месяца за счёт роста повторных визитов. Один постоянный клиент приносит в среднем в 5 раз больше, чем разовый. Мы помогаем превращать разовых гостей в постоянных — это и есть главная ценность.',
   true, 'дорого, цена, стоимость, бюджет, не потянем', 10),
  ('Неинтересно',
   'Понимаю, времени мало. Скажите только одно: вы хотели бы, чтобы клиенты возвращались чаще? Если да — у меня есть 2 минуты показать, как это работает у ваших коллег из той же сферы.',
   true, 'неинтересно, не нужно, не актуально', 20),
  ('Подумаю',
   'Конечно, решение важное. Чтобы вам было о чём думать предметно, давайте я пришлю короткое КП и видео-демо. Посмотрите за 5 минут — и я перезвоню в удобное время. Когда удобнее, завтра или в четверг?',
   true, 'подумаю, посоветуюсь, подумать', 30),
  ('Нет времени',
   'Понял, не буду занимать. Назовите удобное время — 10 минут хватит, чтобы показать главное. Завтра до обеда или после?',
   true, 'нет времени, занят, некогда', 40)
on conflict do nothing;

insert into cheatsheet_blocks (title, content, sort_order) values
  ('О продукте',
   'Мои места — сервис цифровых карт лояльности для локального бизнеса. Заменяет бумажные карточки и пластик: клиент получает карту в Apple/Google Wallet, бизнес — данные о визитах и удобные рассылки.',
   10),
  ('Тарифы',
   '• 25 000 руб + 22% НДС (лицензия) + 3 000 ₽/мес\n• 5 000 ₽/мес — без лицензии\n• 3 000 ₽/мес — лайт-тариф',
   20),
  ('Ключевые отличия',
   '• В отличие от Wallet — полноценная CRM, а не просто карта\n• В отличие от UDS — не берём процент с оборота\n• В отличие от Biglion — работаем на удержание, а не на разовую скидку',
   30),
  ('Скрипт приветствия',
   'Здравствуйте! Меня зовут [Имя], компания «Мои места». Мы помогаем [тип бизнеса] увеличивать возвращаемость клиентов с помощью цифровых карт лояльности. У вас есть пара минут?',
   40)
on conflict do nothing;
