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

  // Формулы (как в Excel):
  //   Сумма = Кол-во × Цена; Итого = сумма всех «Сумм».
  // Цены по умолчанию применяются, если в строке «Цена» пустая.
  const FORMULAS = [
    { qty: 'calls_done_qty',    price: 'calls_done_price',    sum: 'calls_done_sum',    defaultPrice: 30   },
    { qty: 'lpr_qty',           price: 'lpr_price',           sum: 'lpr_sum',           defaultPrice: 100  },
    { qty: 'meetings_done_qty', price: 'meetings_done_price', sum: 'meetings_done_sum', defaultPrice: 500  },
    { qty: 'contracts_qty',     price: 'contracts_price',     sum: 'contracts_sum',     defaultPrice: 3000 },
  ];
  const COMPUTED_KEYS = new Set([...FORMULAS.map(f => f.sum), 'total']);
  const PRICE_KEYS = Object.fromEntries(FORMULAS.map(f => [f.price, f.defaultPrice]));

  // Метрики для статистики (берём только «Кол-во» — считаем действия).
  // Цвета согласованы между KPI-карточкой и соответствующим графиком.
  const STATS_METRICS = [
    { key: 'calls_out_qty',          label: 'Звонки исходящие',     color: '#2563eb' },
    { key: 'calls_done_qty',         label: 'Звонки состоявшиеся',  color: '#059669' },
    { key: 'lpr_qty',                label: 'Выход на ЛПР',         color: '#d97706' },
    { key: 'meetings_scheduled_qty', label: 'Встреч назначено',     color: '#7c3aed' },
    { key: 'meetings_done_qty',      label: 'Встречи состоявшиеся', color: '#db2777' },
    { key: 'tests_qty',              label: 'Запустили тест',       color: '#0d9488' },
    { key: 'contracts_qty',          label: 'Договор заключён',     color: '#dc2626' },
  ];

  const statsState = {
    period: localStorage.getItem('motivation_stats_period') || 'day',
    month: localStorage.getItem('motivation_stats_month') || '', // '' — все месяцы, или 'YYYY-MM'
    entries: [],
    charts: {}, // key -> Chart instance
  };

  const ZOOM_MIN = 50, ZOOM_MAX = 130, ZOOM_STEP = 10;
  function clampZoom(v) {
    const n = Number(v);
    const snapped = Math.round((Number.isFinite(n) ? n : 100) / ZOOM_STEP) * ZOOM_STEP || 100;
    return Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, snapped));
  }

  // Текущее состояние: год/месяц + подгруженные записи по ISO-дате
  const mState = {
    year: new Date().getFullYear(),
    month: new Date().getMonth(), // 0..11
    byDate: {}, // '2026-04-01' -> row
    zoom: clampZoom(Number(localStorage.getItem('motivation_zoom')) || 100),
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

  // ------- Статистика -------
  async function loadAllEntriesForStats() {
    const s = window.operatorSession?.get?.();
    if (!s?.id) return [];
    const { data, error } = await sb.from('motivation_entries')
      .select('*')
      .eq('operator_id', s.id)
      .order('entry_date', { ascending: true });
    if (error) { console.error(error); return []; }
    return data || [];
  }

  // ISO-неделя: YYYY-Www, начало недели — понедельник
  function isoWeekKey(dateStr) {
    const d = new Date(dateStr + 'T00:00:00Z');
    const tmp = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
    const dayNum = tmp.getUTCDay() || 7;
    tmp.setUTCDate(tmp.getUTCDate() + 4 - dayNum);
    const yearStart = new Date(Date.UTC(tmp.getUTCFullYear(), 0, 1));
    const week = Math.ceil((((tmp - yearStart) / 86400000) + 1) / 7);
    return `${tmp.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
  }

  function bucketKey(dateStr, period) {
    if (period === 'day')   return dateStr;            // YYYY-MM-DD
    if (period === 'month') return dateStr.slice(0, 7); // YYYY-MM
    return isoWeekKey(dateStr);
  }

  const ORDINAL_RU = ['Первая','Вторая','Третья','Четвёртая','Пятая','Шестая','Седьмая','Восьмая','Девятая','Десятая'];
  function weekOrdinalLabel(n) {
    return (ORDINAL_RU[n - 1] || (n + '-я')) + ' неделя';
  }

  function formatBucketLabel(key, period, index) {
    if (period === 'day') {
      // '2026-04-02' -> '02.04'
      return key.slice(8) + '.' + key.slice(5, 7);
    }
    if (period === 'month') {
      const [, m] = key.split('-');
      return MONTHS[Number(m) - 1]?.slice(0, 3) || key;
    }
    // неделя: порядковое имя по индексу в отсортированном списке недель
    return weekOrdinalLabel(index + 1);
  }

  function aggregateForChart(entries, metricKey, period) {
    const buckets = {};
    for (const e of entries) {
      const k = bucketKey(e.entry_date, period);
      buckets[k] = (buckets[k] || 0) + (Number(e[metricKey]) || 0);
    }
    const keys = Object.keys(buckets).sort();
    return {
      labels: keys.map((k, i) => formatBucketLabel(k, period, i)),
      values: keys.map(k => buckets[k]),
    };
  }

  // Записи, отфильтрованные по выбранному месяцу в статистике.
  function getFilteredEntries() {
    if (!statsState.month) return statsState.entries;
    return statsState.entries.filter(e => e.entry_date.startsWith(statsState.month));
  }

  // Пересобираем список доступных месяцев в <select> по entries.
  function updateMonthFilterOptions() {
    const sel = document.getElementById('mot-stats-month');
    if (!sel) return;
    const months = [...new Set(statsState.entries.map(e => e.entry_date.slice(0, 7)))].sort().reverse();
    // Если сохранённый месяц больше не актуален — сбрасываем на «все»
    if (statsState.month && !months.includes(statsState.month)) {
      statsState.month = '';
      localStorage.setItem('motivation_stats_month', '');
    }
    sel.innerHTML =
      `<option value="">Все месяцы</option>` +
      months.map(m => {
        const [y, mm] = m.split('-');
        const label = `${MONTHS[Number(mm) - 1]} ${y}`;
        return `<option value="${escapeHtml(m)}"${m === statsState.month ? ' selected' : ''}>${escapeHtml(label)}</option>`;
      }).join('');
  }

  function renderKpis() {
    const el = document.getElementById('mot-kpis');
    if (!el) return;
    const entries = getFilteredEntries();
    const totals = {};
    for (const m of STATS_METRICS) totals[m.key] = 0;
    for (const e of entries) {
      for (const m of STATS_METRICS) totals[m.key] += (Number(e[m.key]) || 0);
    }
    el.innerHTML = STATS_METRICS.map(m => `
      <div class="mot-kpi" style="--kpi-color:${m.color}">
        <div class="mot-kpi-label">${escapeHtml(m.label)}</div>
        <div class="mot-kpi-value">${totals[m.key].toLocaleString('ru-RU')}</div>
      </div>
    `).join('');
  }

  function renderChartsGrid() {
    const el = document.getElementById('mot-charts');
    if (!el) return;
    el.innerHTML = STATS_METRICS.map(m => `
      <div class="mot-chart-card">
        <div class="mot-chart-title"><span class="dot" style="background:${m.color}"></span>${escapeHtml(m.label)}</div>
        <div class="mot-chart-box"><canvas id="mot-chart-${m.key}"></canvas></div>
      </div>
    `).join('');

    const entries = getFilteredEntries();
    for (const m of STATS_METRICS) {
      const { labels, values } = aggregateForChart(entries, m.key, statsState.period);
      const canvas = document.getElementById(`mot-chart-${m.key}`);
      if (!canvas) continue;
      if (statsState.charts[m.key]) statsState.charts[m.key].destroy();
      if (!labels.length) {
        const ctx = canvas.getContext('2d');
        ctx.font = '13px Montserrat, sans-serif';
        ctx.fillStyle = '#A0A9B5';
        ctx.textAlign = 'center';
        ctx.fillText('Нет данных', canvas.width / 2, canvas.height / 2);
        continue;
      }
      statsState.charts[m.key] = new Chart(canvas, {
        type: statsState.period === 'day' ? 'line' : 'bar',
        data: {
          labels,
          datasets: [{
            label: m.label,
            data: values,
            borderColor: m.color,
            backgroundColor: m.color + '33',
            tension: 0.3,
            fill: true,
            pointRadius: 3,
            borderWidth: 2,
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: { legend: { display: false } },
          scales: {
            x: { grid: { display: false } },
            y: { beginAtZero: true, ticks: { precision: 0 } }
          }
        }
      });
    }
  }

  async function refreshStats() {
    statsState.entries = await loadAllEntriesForStats();
    updateMonthFilterOptions();
    renderKpis();
    renderChartsGrid();
  }

  // ---- Формулы на лету ----
  function getInputVal(row, key) {
    const inp = row.querySelector(`input[data-key="${key}"]`);
    if (!inp) return null;
    const raw = inp.value.trim();
    if (raw === '') return null;
    const n = Number(raw);
    return Number.isFinite(n) ? n : null;
  }
  function setCalcCell(row, key, val) {
    const cell = row.querySelector(`.mot-calc[data-key="${key}"]`);
    if (!cell) return;
    if (val == null) cell.textContent = '';
    else cell.textContent = Number(val).toLocaleString('ru-RU');
  }
  function computeRow(row) {
    let total = 0;
    let any = false;
    for (const f of FORMULAS) {
      const qty = getInputVal(row, f.qty);
      const priceRaw = getInputVal(row, f.price);
      const price = priceRaw != null ? priceRaw : f.defaultPrice;
      let sum = null;
      if (qty != null) {
        sum = qty * price;
        total += sum;
        any = true;
      }
      setCalcCell(row, f.sum, sum);
    }
    setCalcCell(row, 'total', any ? total : null);
  }
  function computeAllRows() {
    document.querySelectorAll('#mot-table tbody tr').forEach(computeRow);
  }

  function buildTable() {
    const days = daysInMonth(mState.year, mState.month);
    const colspanMap = {};
    COLS.forEach(c => { colspanMap[c.group] = (colspanMap[c.group] || 0) + 1; });
    const groupsOrdered = [];
    const seen = new Set();
    COLS.forEach(c => { if (!seen.has(c.group)) { groupsOrdered.push(c.group); seen.add(c.group); } });

    // В узких группах (1 колонка) заменяем пробел на <br>, чтобы заголовок
    // шёл в две строки и не растягивал колонку — например, «Звонки / исходящие».
    const groupHtml = (g) => {
      const safe = escapeHtml(g);
      return colspanMap[g] === 1 ? safe.replace(/ /, '<br>') : safe;
    };
    const headerGroups = `<tr>
      <th rowspan="2" class="col-date">Дата</th>
      ${groupsOrdered.map(g => `<th colspan="${colspanMap[g]}">${groupHtml(g)}</th>`).join('')}
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
        if (COMPUTED_KEYS.has(c.key)) {
          // Формульные ячейки — не редактируются, считаются на лету
          return `<td class="mot-calc" data-date="${iso}" data-key="${c.key}">${
            val != null ? Number(val).toLocaleString('ru-RU') : ''
          }</td>`;
        }
        const ph = PRICE_KEYS[c.key];
        return `<td><input type="number" step="any" inputmode="decimal"
                  data-date="${iso}" data-key="${c.key}"
                  value="${val ?? ''}"${ph ? ` placeholder="${ph}"` : ''}></td>`;
      }).join('');
      rows.push(`<tr class="${weekend ? 'weekend' : ''}" data-row-date="${iso}">
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
        <div class="mot-zoom" title="Масштаб таблицы">
          <button class="btn sm" id="mot-zoom-out" type="button">−</button>
          <button class="btn sm" id="mot-zoom-val" type="button" title="Сбросить (100%)">100%</button>
          <button class="btn sm" id="mot-zoom-in" type="button">+</button>
          <button class="btn sm" id="mot-zoom-fit" type="button" title="Подогнать под экран">⤢ Вписать</button>
        </div>
        <div class="mot-actions">
          <span class="mot-hint" id="mot-hint"></span>
          <button class="btn primary" id="mot-save" type="button">💾 Сохранить</button>
        </div>
      </div>
      <div class="mot-table-wrap" id="mot-wrap">
        <table class="mot-table" id="mot-table"></table>
      </div>

      <section class="mot-stats">
        <div class="mot-stats-head">
          <h2>Статистика</h2>
          <div class="mot-stats-controls">
            <label class="mot-month-filter">
              <span>Месяц:</span>
              <select id="mot-stats-month"><option value="">Все месяцы</option></select>
            </label>
            <div class="mot-period" id="mot-period">
              <button type="button" data-period="day">Дни</button>
              <button type="button" data-period="week">Недели</button>
              <button type="button" data-period="month">Месяцы</button>
            </div>
          </div>
        </div>
        <div class="mot-kpis" id="mot-kpis"></div>
        <div class="mot-charts" id="mot-charts"></div>
      </section>
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
    document.getElementById('mot-zoom-in').addEventListener('click', () => setZoom(mState.zoom + ZOOM_STEP));
    document.getElementById('mot-zoom-out').addEventListener('click', () => setZoom(mState.zoom - ZOOM_STEP));
    document.getElementById('mot-zoom-val').addEventListener('click', () => setZoom(100));
    document.getElementById('mot-zoom-fit').addEventListener('click', fitZoom);

    // Пересчёт формул при любом вводе внутри таблицы
    document.getElementById('mot-table').addEventListener('input', (e) => {
      const inp = e.target;
      if (!inp.dataset || !inp.dataset.date) return;
      const row = inp.closest('tr');
      if (row) computeRow(row);
    });

    // Переключатель периода для статистики
    const periodEl = document.getElementById('mot-period');
    periodEl.querySelectorAll('button').forEach(b => {
      b.classList.toggle('active', b.dataset.period === statsState.period);
      b.addEventListener('click', () => {
        statsState.period = b.dataset.period;
        localStorage.setItem('motivation_stats_period', statsState.period);
        periodEl.querySelectorAll('button').forEach(x => x.classList.toggle('active', x === b));
        renderChartsGrid();
      });
    });

    // Выбор месяца в статистике
    document.getElementById('mot-stats-month').addEventListener('change', (e) => {
      statsState.month = e.target.value;
      localStorage.setItem('motivation_stats_month', statsState.month);
      renderKpis();
      renderChartsGrid();
    });

    trackMotHeadHeight();
    await refresh();
    applyZoom();
    await refreshStats();
  }

  function applyZoom() {
    const wrap = document.getElementById('mot-wrap');
    if (!wrap) return;
    // ВАЖНО: при zoom=100% НЕ выставляем style.zoom — даже `zoom: 1`
    // в Chrome создаёт containing block и ломает sticky у потомков
    // (см. https://crbug.com/1254081). Без атрибута sticky у thead
    // работает как надо.
    if (mState.zoom === 100) {
      wrap.style.zoom = '';
    } else {
      wrap.style.zoom = mState.zoom / 100;
    }
    const val = document.getElementById('mot-zoom-val');
    if (val) val.textContent = mState.zoom + '%';
  }

  // Обновляет CSS-переменную --mot-head-h, от которой зависит
  // offset sticky-шапки таблицы. Зовём после рендера и на resize,
  // потому что .mot-head может перенестись на 2 строки на узком экране.
  let _motHeadRO = null;
  function trackMotHeadHeight() {
    const head = document.querySelector('.mot-head');
    if (!head) return;
    const update = () => {
      document.documentElement.style.setProperty('--mot-head-h', head.offsetHeight + 'px');
    };
    update();
    if (_motHeadRO) _motHeadRO.disconnect();
    if (typeof ResizeObserver !== 'undefined') {
      _motHeadRO = new ResizeObserver(update);
      _motHeadRO.observe(head);
    } else {
      window.addEventListener('resize', update);
    }
  }

  function setZoom(v) {
    mState.zoom = clampZoom(v);
    localStorage.setItem('motivation_zoom', String(mState.zoom));
    applyZoom();
  }

  // Подогнать зум так, чтобы таблица помещалась в ширину контейнера без горизонтального скролла
  function fitZoom() {
    const wrap = document.getElementById('mot-wrap');
    const table = document.getElementById('mot-table');
    if (!wrap || !table) return;
    // сбрасываем зум для честного измерения
    wrap.style.zoom = 1;
    const available = wrap.clientWidth;
    const needed = table.scrollWidth;
    if (!needed) return;
    const ratio = Math.floor((available / needed) * 100 / ZOOM_STEP) * ZOOM_STEP;
    setZoom(ratio >= 100 ? 100 : clampZoom(ratio));
  }

  function updateTitle() {
    document.getElementById('mot-title').textContent = `${MONTHS[mState.month]} ${mState.year}`;
  }

  async function refresh() {
    updateTitle();
    await loadMonth();
    const table = document.getElementById('mot-table');
    table.innerHTML = buildTable();
    computeAllRows();
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

    // Собираем по строкам — читаем инпуты (то, что ввёл пользователь),
    // затем пересчитываем формульные поля на клиенте и кладём их в тот же объект.
    const byDate = {};
    document.querySelectorAll('#mot-table tbody tr[data-row-date]').forEach(tr => {
      const date = tr.dataset.rowDate;
      const fields = {};
      tr.querySelectorAll('input[data-date]').forEach(inp => {
        const raw = inp.value.trim();
        fields[inp.dataset.key] = raw === '' ? null : Number(raw);
      });
      // формулы
      let total = 0, any = false;
      for (const f of FORMULAS) {
        const qty = fields[f.qty];
        const price = fields[f.price] != null ? fields[f.price] : f.defaultPrice;
        if (qty != null) {
          fields[f.sum] = qty * price;
          total += qty * price;
          any = true;
        } else {
          fields[f.sum] = null;
        }
      }
      fields.total = any ? total : null;
      byDate[date] = fields;
    });

    // Отправляем только те строки, где есть хотя бы одно **введённое** поле.
    // Вычисленные поля (сумма/итого) не считаются признаком ввода.
    const inputKeys = COLS.map(c => c.key).filter(k => !COMPUTED_KEYS.has(k));
    const toUpsert = [];
    for (const [date, fields] of Object.entries(byDate)) {
      const hasAny = inputKeys.some(k => fields[k] !== null && fields[k] !== undefined && !Number.isNaN(fields[k]));
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
      // чтобы «стирание» работало как ожидается. Проверяем только введённые поля,
      // чтобы computed-поля (sum/total) не мешали определить «пустую» строку.
      const clearedDates = Object.entries(byDate)
        .filter(([, fields]) => inputKeys.every(k => fields[k] === null || fields[k] === undefined))
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
      // Перестраиваем статистику, чтобы сразу увидеть новые цифры/графики
      refreshStats();
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
