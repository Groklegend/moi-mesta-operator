-- ============================================================
-- Миграция 01: комментарии оператора к возражениям
-- Выполнить в Supabase SQL Editor один раз
-- ============================================================

create table if not exists objection_comments (
  id           uuid primary key default gen_random_uuid(),
  objection_id uuid references objections(id) on delete cascade,
  comment_text text not null,
  created_at   timestamptz default now()
);

create index if not exists idx_objection_comments_objection on objection_comments(objection_id);
create index if not exists idx_objection_comments_created on objection_comments(created_at desc);

alter table objection_comments enable row level security;

drop policy if exists "public insert comments" on objection_comments;
drop policy if exists "public read comments"   on objection_comments;
drop policy if exists "auth read comments"     on objection_comments;
drop policy if exists "auth delete comments"   on objection_comments;

-- Чтение и запись публичные, удаление — только админ
create policy "public insert comments" on objection_comments for insert to anon, authenticated with check (true);
create policy "public read comments"   on objection_comments for select to anon, authenticated using (true);
create policy "auth delete comments"   on objection_comments for delete to authenticated using (true);
