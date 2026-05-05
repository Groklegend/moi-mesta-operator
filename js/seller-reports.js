// ============================================================
// Ежедневный отчёт продажника (ТЗ «Форма ежедневный отчёт продажника»)
// ============================================================
// Структура: одна строка таблицы — один день. 8 числовых колонок воронки.
// Загрузка строк месяца за один select. Сохранение — bulk upsert.
// Автосохранение через 30 сек после последней правки (на dirty-строках).
// При редактировании задним числом каждое изменение поля → audit.log.

(function () {
  // Гард: модуль работает только на seller.html (там есть #r-table).
  if (!document.getElementById('r-table')) return;

  const COLS = [
    'meetings_scheduled',
    'meetings_held',
    'agreed_to_test',
    'refused',
    'thinking',
    'integration_needed',
    'launched_on_test',
    'signed_and_paid',
  ];

  const MONTHS_RU = [
    'Январь','Февраль','Март','Апрель','Май','Июнь',
    'Июль','Август','Сентябрь','Октябрь','Ноябрь','Декабрь',
  ];

  const state = {
    sellerId: null,
    year: new Date().getFullYear(),
    month: new Date().getMonth(), // 0..11
    rowsByDate: {}, // 'YYYY-MM-DD' → { id, ...fields, _original: {...}, _dirty: false }
  };

  let autosaveTimer = null;

  // ---------- Утилиты ----------

  function pad(n) { return String(n).padStart(2, '0'); }
  function isoDate(year, month, day) { return `${year}-${pad(month + 1)}-${pad(day)}`; }
  function todayIso() {
    const d = new Date();
    return isoDate(d.getFullYear(), d.getMonth(), d.getDate());
  }
  function daysInMonth(year, month) { return new Date(year, month + 1, 0).getDate(); }
  function dayOfWeek(year, month, day) { return new Date(year, month, day).getDay(); } // 0=Вс, 6=Сб

  function emptyRow(date) {
    const r = { id: null, seller_id: state.sellerId, report_date: date };
    for (const k of COLS) r[k] = 0;
    r._original = { ...r };
    r._dirty = false;
    return r;
  }

  function readCellValue(input) {
    const raw = (input.value || '').trim();
    if (raw === '') return 0;
    let n = parseInt(raw, 10);
    if (!Number.isFinite(n) || n < 0) n = 0;
    if (n > 999) n = 999;
    return n;
  }

  function showSavedFlag() {
    const el = document.getElementById('r-saved');
    if (!el) return;
    el.hidden = false;
    clearTimeout(showSavedFlag._t);
    showSavedFlag._t = setTimeout(() => { el.hidden = true; }, 1800);
  }

  function toast(msg) {
    const t = document.getElementById('toast');
    if (!t) return;
    t.textContent = msg;
    t.classList.remove('hidden');
    clearTimeout(toast._t);
    toast._t = setTimeout(() => t.classList.add('hidden'), 1800);
  }

  // ---------- Загрузка ----------

  async function loadMonth() {
    const tbody = document.querySelector('#r-table tbody');
    tbody.innerHTML = `<tr><td colspan="9" class="empty">Загрузка…</td></tr>`;

    const { data: { user } } = await sb.auth.getUser();
    if (!user) { tbody.innerHTML = `<tr><td colspan="9" class="empty">Нет сессии</td></tr>`; return; }
    state.sellerId = user.id;

    const days = daysInMonth(state.year, state.month);
    const fromIso = isoDate(state.year, state.month, 1);
    const toIso = isoDate(state.year, state.month, days);

    const { data, error } = await sb
      .from('seller_daily_reports')
      .select('*')
      .eq('seller_id', state.sellerId)
      .gte('report_date', fromIso)
      .lte('report_date', toIso);

    if (error) {
      tbody.innerHTML = `<tr><td colspan="9" class="empty">Ошибка: ${escapeHtml(error.message)}</td></tr>`;
      return;
    }

    state.rowsByDate = {};
    for (let d = 1; d <= days; d++) {
      const iso = isoDate(state.year, state.month, d);
      state.rowsByDate[iso] = emptyRow(iso);
    }
    for (const row of (data || [])) {
      const orig = {};
      for (const k of COLS) orig[k] = row[k] ?? 0;
      state.rowsByDate[row.report_date] = {
        id: row.id,
        seller_id: row.seller_id,
        report_date: row.report_date,
        ...orig,
        _original: { ...orig, id: row.id },
        _dirty: false,
      };
    }
    render();
  }

  // ---------- Рендер ----------

  function render() {
    document.getElementById('r-month').textContent = `${MONTHS_RU[state.month]} ${state.year}`;
    const tbody = document.querySelector('#r-table tbody');
    const days = daysInMonth(state.year, state.month);
    const today = todayIso();
    const html = [];
    for (let d = 1; d <= days; d++) {
      const iso = isoDate(state.year, state.month, d);
      const row = state.rowsByDate[iso] || emptyRow(iso);
      const wd = dayOfWeek(state.year, state.month, d);
      const isWeekend = wd === 0 || wd === 6;
      const isToday = iso === today;
      const cls = [
        isToday ? 'today' : '',
        isWeekend ? 'weekend' : '',
      ].filter(Boolean).join(' ');
      const dayLabel = `${pad(d)}.${pad(state.month + 1)}` + (isWeekend ? ' <span class="wk">вых</span>' : '');
      html.push(`<tr class="${cls}" data-date="${iso}">
        <td class="col-date">${dayLabel}</td>
        ${COLS.map(k => `
          <td><input type="number" min="0" max="999" inputmode="numeric"
            data-field="${k}" data-date="${iso}"
            value="${row[k] ? row[k] : ''}"></td>`).join('')}
      </tr>`);
    }
    tbody.innerHTML = html.join('');
    attachInputHandlers();
    recomputeTotals();
  }

  function attachInputHandlers() {
    document.querySelectorAll('#r-table tbody input').forEach(inp => {
      inp.addEventListener('input', onInputChange);
      inp.addEventListener('focus', () => inp.select());
    });
  }

  function onInputChange(e) {
    const inp = e.target;
    const date = inp.dataset.date;
    const field = inp.dataset.field;
    const row = state.rowsByDate[date];
    if (!row) return;
    const newVal = readCellValue(inp);
    if (row[field] !== newVal) {
      row[field] = newVal;
      row._dirty = true;
    }
    recomputeTotals();
    scheduleAutosave();
  }

  function recomputeTotals() {
    const totals = {};
    for (const k of COLS) totals[k] = 0;
    for (const row of Object.values(state.rowsByDate)) {
      for (const k of COLS) totals[k] += row[k] || 0;
    }
    for (const k of COLS) {
      const el = document.querySelector(`#r-table tfoot [data-total="${k}"]`);
      if (el) el.textContent = String(totals[k]);
    }
  }

  // ---------- Сохранение ----------

  function scheduleAutosave() {
    clearTimeout(autosaveTimer);
    autosaveTimer = setTimeout(() => { saveAll(true); }, 30_000);
  }

  async function saveAll(silent) {
    clearTimeout(autosaveTimer);
    const dirty = Object.values(state.rowsByDate).filter(r => r._dirty);
    if (dirty.length === 0) {
      if (!silent) toast('Нет изменений для сохранения');
      return;
    }

    const today = todayIso();
    const auditPlan = [];

    // Готовим payload только для строк с непустыми изменениями.
    // Идемпотентно отправим upsert по (seller_id, report_date).
    const payload = dirty.map(r => {
      const out = { seller_id: r.seller_id, report_date: r.report_date };
      for (const k of COLS) out[k] = r[k] || 0;

      // Аудит «задним числом»: если report_date < today — пишем по каждому
      // изменённому полю.
      if (r.report_date < today) {
        for (const k of COLS) {
          const oldV = r._original[k] || 0;
          const newV = out[k];
          if (oldV !== newV) {
            auditPlan.push({
              field: k, old_value: oldV, new_value: newV,
              report_date: r.report_date, target_id: r.id || null,
            });
          }
        }
      }
      return out;
    });

    const btn = document.getElementById('r-save');
    if (btn) { btn.disabled = true; btn.textContent = 'Сохраняем…'; }

    const { data, error } = await sb
      .from('seller_daily_reports')
      .upsert(payload, { onConflict: 'seller_id,report_date' })
      .select();

    if (btn) { btn.disabled = false; btn.textContent = '💾 Сохранить'; }

    if (error) {
      toast('Ошибка: ' + error.message);
      return;
    }

    // Подставим id в локальные строки (для свежесозданных).
    for (const saved of (data || [])) {
      const r = state.rowsByDate[saved.report_date];
      if (!r) continue;
      r.id = saved.id;
      r._dirty = false;
      const orig = {};
      for (const k of COLS) orig[k] = saved[k] ?? 0;
      r._original = { ...orig, id: saved.id };
    }

    // Аудит — после успешного сохранения, чтобы target_id указывал на реальную запись.
    for (const a of auditPlan) {
      if (!a.target_id) {
        const r = Object.values(state.rowsByDate).find(x => x.report_date === a.report_date);
        a.target_id = r?.id || null;
      }
      if (window.audit) {
        audit.log({
          action: 'report_edit',
          target_type: 'seller_daily_report',
          target_id: a.target_id,
          metadata: {
            report_date: a.report_date,
            field: a.field,
            old_value: a.old_value,
            new_value: a.new_value,
          },
        });
      }
    }

    showSavedFlag();
    if (!silent) toast('Сохранено');
  }

  // ---------- Навигация по месяцам ----------

  function shiftMonth(delta) {
    let m = state.month + delta;
    let y = state.year;
    if (m < 0) { m = 11; y--; }
    if (m > 11) { m = 0; y++; }
    state.year = y; state.month = m;
    loadMonth();
  }
  function jumpToToday() {
    const d = new Date();
    state.year = d.getFullYear();
    state.month = d.getMonth();
    loadMonth().then(() => {
      const el = document.querySelector(`#r-table tbody tr[data-date="${todayIso()}"]`);
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
  }

  document.getElementById('r-prev').addEventListener('click', () => shiftMonth(-1));
  document.getElementById('r-next').addEventListener('click', () => shiftMonth(+1));
  document.getElementById('r-today').addEventListener('click', jumpToToday);
  document.getElementById('r-save').addEventListener('click', () => saveAll(false));

  // Сохраним до ухода со страницы, если есть несохранённое.
  window.addEventListener('beforeunload', (e) => {
    const dirty = Object.values(state.rowsByDate).some(r => r._dirty);
    if (dirty) {
      e.preventDefault();
      e.returnValue = '';
    }
  });

  // Старт.
  loadMonth();
})();
