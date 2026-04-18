// ============================================================
// Режим «Мотивация» — ежедневные показатели оператора.
// Таблица как в Excel, одна кнопка «Сохранить» на всё.
// Формулы пока не считаем — просто поля ввода + апсерт в БД.
// ============================================================
(function () {
  // Колонки таблицы: ключ в БД + подпись.
  // groups — для двухуровневой шапки (как в Excel).
  const COLS = [
    { key: 'calls_out_qty',          group: 'Звонки исходящие',    sub: 'Кол-во' },

    { key: 'calls_done_qty',         group: 'Звонки состоявшиеся', sub: 'Кол-во' },
    { key: 'calls_done_price',       group: 'Звонки состоявшиеся', sub: 'Цена'   },
    { key: 'calls_done_sum',         group: 'Звонки состоявшиеся', sub: 'Сумма'  },

    { key: 'lpr_qty',                group: 'Выход на ЛПР',        sub: 'Кол-во' },
    { key: 'lpr_price',              group: 'Выход на ЛПР',        sub: 'Цена'   },
    { key: 'lpr_sum',                group: 'Выход на ЛПР',        sub: 'Сумма'  },

    { key: 'meetings_scheduled_qty', group: 'Встреч назначено',    sub: 'Кол-во' },

    { key: 'meetings_done_qty',      group: 'Встречи состоявшиеся',sub: 'Кол-во' },
    { key: 'meetings_done_price',    group: 'Встречи состоявшиеся',sub: 'Цена'   },
    { key: 'meetings_done_sum',      group: 'Встречи состоявшиеся',sub: 'Сумма'  },

    { key: 'tests_qty',              group: 'Запустили тест',      sub: 'Кол-во' },

    { key: 'contracts_qty',          group: 'Договор заключён',    sub: 'Кол-во' },
    { key: 'contracts_price',        group: 'Договор заключён',    sub: 'Цена'   },
    { key: 'contracts_sum',          group: 'Договор заключён',    sub: 'Сумма'  },

    { key: 'total',                  group: 'Итого',               sub: '' },
  ];

  // Текущее состояние: год/месяц + подгруженные записи по ISO-дате
  const mState = {
    year: new Date().getFullYear(),
    month: new Date().getMonth(), // 0..11
    byDate: {}, // '2026-04-01' -> row
  };

  function isoDate(y, m, d) {
    const mm = String(m + 1).padStart(2, '0');
    const dd = String(d).padStart(2, '0');
    return `${y}-${mm}-${dd}`;
  }
  function daysInMonth(y, m) { return new Date(y, m + 1, 0).getDate(); }
  const MONTHS = ['Январь','Февраль','Март','Апрель','Май','Июнь','Июль','Август','Сентябрь','Октябрь','Ноябрь','Декабрь'];

  async function loadMonth() {
    const s = window.operatorSession?.get?.();
    if (!s?.id) return;
    const from = isoDate(mState.year, mState.month, 1);
    const to   = isoDate(mState.year, mState.month, daysInMonth(mState.year, mState.month));
    const { data, error } = await sb.from('motivation_entries')
      .select('*')
      .eq('operator_id', s.id)
      .gte('entry_date', from)
      .lte('entry_date', to);
    if (error) {
      console.error(error);
      toast?.('Ошибка загрузки: ' + error.message);
      mState.byDate = {};
      return;
    }
    mState.byDate = Object.fromEntries((data || []).map(r => [r.entry_date, r]));
  }

  function buildTable() {
    const days = daysInMonth(mState.year, mState.month);
    const colspanMap = {};
    COLS.forEach(c => { colspanMap[c.group] = (colspanMap[c.group] || 0) + 1; });
    const groupsOrdered = [];
    const seen = new Set();
    COLS.forEach(c => { if (!seen.has(c.group)) { groupsOrdered.push(c.group); seen.add(c.group); } });

    const headerGroups = `<tr>
      <th rowspan="2" class="col-date">Дата</th>
      ${groupsOrdered.map(g => `<th colspan="${colspanMap[g]}">${escapeHtml(g)}</th>`).join('')}
    </tr>`;
    const headerSubs = `<tr>
      ${COLS.map(c => `<th>${escapeHtml(c.sub || '—')}</th>`).join('')}
    </tr>`;

    const rows = [];
    for (let d = 1; d <= days; d++) {
      const date = new Date(mState.year, mState.month, d);
      const dow = date.getDay(); // 0 = вс, 6 = сб
      const weekend = dow === 0 || dow === 6;
      const iso = isoDate(mState.year, mState.month, d);
      const rec = mState.byDate[iso] || {};
      const label = `${String(d).padStart(2,'0')}.${String(mState.month + 1).padStart(2,'0')}`;
      const cells = COLS.map(c => {
        const val = rec[c.key];
        return `<td><input type="number" step="any" inputmode="decimal"
                  data-date="${iso}" data-key="${c.key}"
                  value="${val ?? ''}"></td>`;
      }).join('');
      rows.push(`<tr class="${weekend ? 'weekend' : ''}">
        <td class="col-date">${label}${weekend ? ' <span class="mut">вых</span>' : ''}</td>
        ${cells}
      </tr>`);
    }

    return `
      <thead>${headerGroups}${headerSubs}</thead>
      <tbody>${rows.join('')}</tbody>
    `;
  }

  async function render() {
    const pane = document.getElementById('motivation-pane');
    if (!pane) return;
    const s = window.operatorSession?.get?.();
    if (!s?.id) { pane.innerHTML = '<div class="placeholder">Нет сессии</div>'; return; }

    pane.innerHTML = `
      <div class="mot-head">
        <div class="mot-nav">
          <button class="btn sm" id="mot-prev" type="button">←</button>
          <div class="mot-title" id="mot-title">—</div>
          <button class="btn sm" id="mot-next" type="button">→</button>
          <button class="btn sm" id="mot-today" type="button">Сегодня</button>
        </div>
        <div class="mot-actions">
          <span class="mot-hint" id="mot-hint"></span>
          <button class="btn primary" id="mot-save" type="button">💾 Сохранить</button>
        </div>
      </div>
      <div class="mot-table-wrap">
        <table class="mot-table" id="mot-table"></table>
      </div>
    `;

    document.getElementById('mot-prev').addEventListener('click', () => shiftMonth(-1));
    document.getElementById('mot-next').addEventListener('click', () => shiftMonth(1));
    document.getElementById('mot-today').addEventListener('click', () => {
      const now = new Date();
      mState.year = now.getFullYear();
      mState.month = now.getMonth();
      refresh();
    });
    document.getElementById('mot-save').addEventListener('click', save);

    await refresh();
  }

  function updateTitle() {
    document.getElementById('mot-title').textContent = `${MONTHS[mState.month]} ${mState.year}`;
  }

  async function refresh() {
    updateTitle();
    await loadMonth();
    document.getElementById('mot-table').innerHTML = buildTable();
    document.getElementById('mot-hint').textContent = '';
  }

  function shiftMonth(delta) {
    let y = mState.year, m = mState.month + delta;
    if (m < 0) { m = 11; y--; }
    if (m > 11) { m = 0; y++; }
    mState.year = y; mState.month = m;
    refresh();
  }

  async function save() {
    const s = window.operatorSession?.get?.();
    if (!s?.id) { toast?.('Нет сессии'); return; }

    // Собираем строки по дате
    const byDate = {};
    document.querySelectorAll('#mot-table input[data-date]').forEach(inp => {
      const d = inp.dataset.date, k = inp.dataset.key;
      const raw = inp.value.trim();
      if (!byDate[d]) byDate[d] = {};
      byDate[d][k] = raw === '' ? null : Number(raw);
    });

    // Отправляем только те строки, где есть хотя бы одно заполненное поле
    const toUpsert = [];
    for (const [date, fields] of Object.entries(byDate)) {
      const hasAny = Object.values(fields).some(v => v !== null && !Number.isNaN(v));
      if (!hasAny) continue;
      toUpsert.push({ operator_id: s.id, entry_date: date, ...fields });
    }

    const btn = document.getElementById('mot-save');
    btn.disabled = true;
    btn.textContent = 'Сохраняем…';

    try {
      if (toUpsert.length) {
        const { error } = await sb.from('motivation_entries')
          .upsert(toUpsert, { onConflict: 'operator_id,entry_date' });
        if (error) throw error;
      }
      // Удаляем полностью очищенные записи за отображаемый месяц,
      // чтобы «стирание» работало как ожидается.
      const clearedDates = Object.entries(byDate)
        .filter(([, fields]) => Object.values(fields).every(v => v === null))
        .map(([d]) => d);
      if (clearedDates.length) {
        await sb.from('motivation_entries')
          .delete()
          .eq('operator_id', s.id)
          .in('entry_date', clearedDates);
      }
      document.getElementById('mot-hint').textContent =
        `Сохранено: ${toUpsert.length} ${plural(toUpsert.length, 'запись', 'записи', 'записей')}`;
      toast?.('Сохранено');
    } catch (err) {
      console.error(err);
      toast?.('Ошибка: ' + (err.message || err));
    } finally {
      btn.disabled = false;
      btn.textContent = '💾 Сохранить';
    }
  }

  function plural(n, one, few, many) {
    const mod10 = n % 10, mod100 = n % 100;
    if (mod10 === 1 && mod100 !== 11) return one;
    if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return few;
    return many;
  }

  window.renderMotivation = render;
})();
