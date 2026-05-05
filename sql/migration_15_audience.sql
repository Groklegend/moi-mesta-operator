-- ============================================================
-- Миграция 15: разделение базы знаний на «оператора» и «менеджера»
-- У каждой записи в categories / objections / documents появляется
-- audience: 'operator' или 'seller'. По дефолту — 'operator', чтобы
-- старые данные оставались в кабинете оператора.
-- ============================================================

alter table categories  add column if not exists audience text not null default 'operator';
alter table objections  add column if not exists audience text not null default 'operator';
alter table documents   add column if not exists audience text not null default 'operator';

create index if not exists categories_audience_idx on categories (audience);
create index if not exists objections_audience_idx on objections (audience);
create index if not exists documents_audience_idx  on documents (audience);

-- Constraint: только два валидных значения.
do $$ begin
  alter table categories add constraint categories_audience_chk check (audience in ('operator','seller'));
exception when duplicate_object then null; end $$;
do $$ begin
  alter table objections add constraint objections_audience_chk check (audience in ('operator','seller'));
exception when duplicate_object then null; end $$;
do $$ begin
  alter table documents add constraint documents_audience_chk check (audience in ('operator','seller'));
exception when duplicate_object then null; end $$;
