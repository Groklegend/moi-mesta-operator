-- ============================================================
-- Seed: данные «Мотивации» Елены за апрель 2026 (со скриншота Excel,
-- полный месяц 01-30.04, 22 рабочих дня, ИТОГО = 35 640).
-- Запустить в Supabase SQL Editor ПОСЛЕ migration_05_motivation.sql
-- и после того, как оператор `elena` уже создан в админке.
-- Скрипт идемпотентен: можно запускать повторно — существующие строки
-- будут перезаписаны.
-- ============================================================

do $$
declare
  op_id uuid;
begin
  select id into op_id from operators where lower(login) = 'elena' limit 1;
  if op_id is null then
    raise exception 'Оператор с логином "elena" не найден. Создай его в админке /admin.html → Операторы.';
  end if;

  -- Колонки в порядке:
  -- operator_id, entry_date,
  -- calls_out_qty (B),
  -- calls_done_qty (C), calls_done_price (D), calls_done_sum (E),
  -- lpr_qty (F), lpr_price (G), lpr_sum (H),
  -- meetings_scheduled_qty (I),
  -- meetings_done_qty (J), meetings_done_price (K), meetings_done_sum (L),
  -- tests_qty (M),
  -- contracts_qty (N), contracts_price (O), contracts_sum (P),
  -- total (Q)
  insert into motivation_entries (
    operator_id, entry_date,
    calls_out_qty,
    calls_done_qty, calls_done_price, calls_done_sum,
    lpr_qty, lpr_price, lpr_sum,
    meetings_scheduled_qty,
    meetings_done_qty, meetings_done_price, meetings_done_sum,
    tests_qty,
    contracts_qty, contracts_price, contracts_sum,
    total
  ) values
    (op_id, '2026-04-01',  98,   40, 30, 1200,    3, 100,  300,    1, NULL, 500,    0, NULL, NULL, 3000, 0, 1500),
    (op_id, '2026-04-02', 121,   40, 30, 1200, NULL, 100,    0,    2,    2, 500, 1000,    2, NULL, 3000, 0, 2200),
    (op_id, '2026-04-03', NULL, NULL, 30,    0, NULL, 100,    0, NULL, NULL, 500,    0, NULL, NULL, 3000, 0,    0),
    (op_id, '2026-04-06', 116,   41, 30, 1230,    2, 100,  200, NULL, NULL, 500,    0, NULL, NULL, 3000, 0, 1430),
    (op_id, '2026-04-07',  97,   40, 30, 1200, NULL, 100,    0,    1,    1, 500,  500,    1, NULL, 3000, 0, 1700),
    (op_id, '2026-04-08',  80,   30, 30,  900, NULL, 100,    0,    1, NULL, 500,    0, NULL, NULL, 3000, 0,  900),
    (op_id, '2026-04-09', NULL, NULL, 30,    0, NULL, 100,    0, NULL,    1, 500,  500, NULL, NULL, 3000, 0,  500),
    (op_id, '2026-04-10',  55,   30, 30,  900,    1, 100,  100, NULL, NULL, 500,    0, NULL, NULL, 3000, 0, 1000),
    (op_id, '2026-04-13', NULL, NULL, 30,    0, NULL, 100,    0, NULL, NULL, 500,    0, NULL, NULL, 3000, 0,    0),
    (op_id, '2026-04-14',  98,   50, 30, 1500, NULL, 100,    0,    1, NULL, 500,    0, NULL, NULL, 3000, 0, 1500),
    (op_id, '2026-04-15',  82,   40, 30, 1200, NULL, 100,    0,    1, NULL, 500,    0, NULL, NULL, 3000, 0, 1200),
    (op_id, '2026-04-16', 103,   41, 30, 1230, NULL, 100,    0, NULL,    2, 500, 1000,    1, NULL, 3000, 0, 2230),
    (op_id, '2026-04-17', 145,   50, 40, 2000,    2, 100,  200, NULL, NULL, 500,    0, NULL, NULL, 3000, 0, 2200),
    (op_id, '2026-04-20',  23,   10, 30,  300, NULL, 100,    0, NULL, NULL, 500,    0, NULL, NULL, 3000, 0,  300),
    (op_id, '2026-04-21', NULL, NULL, NULL,  0, NULL, 100,    0, NULL, NULL, 500,    0, NULL, NULL, 3000, 0,    0),
    (op_id, '2026-04-22',  27,   40, 35, 1400,    6, 100,  600, NULL, NULL, 500,    0, NULL, NULL, 3000, 0, 2000),
    (op_id, '2026-04-23',  54,   40, 35, 1400,   11, 100, 1100,    1,    1, 500,  500, NULL, NULL, 3000, 0, 3000),
    (op_id, '2026-04-24',  22,   16, 30,  480,    8, 100,  800,    1,    1, 500,  500,    1, NULL, 3000, 0, 1780),
    (op_id, '2026-04-27', NULL, NULL, NULL,  0, NULL, 100,    0, NULL, NULL, 500,    0, NULL, NULL, 3000, 0,    0),
    (op_id, '2026-04-28',  84,   50, 40, 2000,   17, 100, 1700,    4, NULL, 500,    0, NULL, NULL, 3000, 0, 3700),
    (op_id, '2026-04-29',  83,   50, 40, 2000,   12, 100, 1200, NULL,    4, 700, 2800,    1, NULL, 3000, 0, 6000),
    (op_id, '2026-04-30',  94,   40, 35, 1400,   11, 100, 1100, NULL, NULL, 500,    0, NULL, NULL, 3000, 0, 2500)
  on conflict (operator_id, entry_date) do update set
    calls_out_qty          = excluded.calls_out_qty,
    calls_done_qty         = excluded.calls_done_qty,
    calls_done_price       = excluded.calls_done_price,
    calls_done_sum         = excluded.calls_done_sum,
    lpr_qty                = excluded.lpr_qty,
    lpr_price              = excluded.lpr_price,
    lpr_sum                = excluded.lpr_sum,
    meetings_scheduled_qty = excluded.meetings_scheduled_qty,
    meetings_done_qty      = excluded.meetings_done_qty,
    meetings_done_price    = excluded.meetings_done_price,
    meetings_done_sum      = excluded.meetings_done_sum,
    tests_qty              = excluded.tests_qty,
    contracts_qty          = excluded.contracts_qty,
    contracts_price        = excluded.contracts_price,
    contracts_sum          = excluded.contracts_sum,
    total                  = excluded.total,
    updated_at             = now();

  raise notice 'Мотивация Елены за апрель 2026: 22 рабочих дня, ИТОГО = 35 640.';
end$$;
