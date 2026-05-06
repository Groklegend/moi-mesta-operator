// Раздел «Календарь» в кабинете менеджера.
// Менеджер сам отмечает занятые слоты (личные дела, обучение, встречи
// вне Хаба). Оператор в «Заявке Плюс» видит эти блокировки в правой
// панели расписания вместе со встречами из таблицы leads — общий
// список занятости через RPC get_busy_slots.

(function () {
  'use strict';

  const $ = (sel, el = document) => el.querySelector(sel);

  const state = {
    view: 'today',          // 'today' | 'month' | 'week'
    cursor: null,           // Date — опорная дата (любой день внутри периода)
    events: [],             // объединённый список событий (leads + blocks) на видимый период
    initialized: false,
    userId: null,
    selectedDay: null,      // 'YYYY-MM-DD' — выбранный день для sidebar (Month/Week)
    selectedEventId: null,  // id выбранной карточки
    stepMinutes: 60,        // 60 | 90 | 120 — шаг сетки часов в режиме Today
  };

  const HOUR_FROM = 8;
  const HOUR_TO = 20;

  // ---------- Московское время ----------
  // Все timestamptz в БД хранятся в UTC. На фронте показываем и интерпретируем
  // как Europe/Moscow (+03:00, без DST), чтобы оператор и менеджер видели
  // одно и то же время независимо от tz браузера.
  function _mskParts(date) {
    const fmt = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Europe/Moscow',
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hour12: false,
    });
    const parts = Object.fromEntries(
      fmt.formatToParts(date).filter((p) => p.type !== 'literal').map((p) => [p.type, p.value])
    );
    return { y: +parts.year, mo: +parts.month, d: +parts.day, h: +parts.hour, mi: +parts.minute };
  }
  function mskHM(d) { const p = _mskParts(d); return { h: p.h, m: p.mi }; }
  function mskYmdOf(d) { const p = _mskParts(d); return `${p.y}-${String(p.mo).padStart(2,'0')}-${String(p.d).padStart(2,'0')}`; }
  function mskToUtcIso(ymdStr, hm) { return `${ymdStr}T${hm || '00:00'}:00+03:00`; }
  // Шаг хранится в БД (users.cal_step_minutes). localStorage — только
  // быстрый кеш до получения свежего значения от сервера.
  const STEP_KEY = 'mm_cal_step_minutes_v1';
  function loadStepCache() {
    const v = parseInt(localStorage.getItem(STEP_KEY) || '60', 10);
    return [60, 90].includes(v) ? v : 60;
  }
  function saveStepCache(min) { try { localStorage.setItem(STEP_KEY, String(min)); } catch (_) {} }
  async function loadStepFromDb() {
    if (!state.userId) return loadStepCache();
    const { data, error } = await sb.from('users').select('cal_step_minutes').eq('id', state.userId).maybeSingle();
    if (error) { console.warn('cal_step load:', error); return loadStepCache(); }
    const v = data?.cal_step_minutes;
    return [60, 90].includes(v) ? v : 60;
  }
  async function saveStepToDb(min) {
    saveStepCache(min);
    const { error } = await sb.rpc('set_my_cal_step', { step: min });
    if (error) console.warn('set_my_cal_step:', error);
  }

  // ---------- Утилиты ----------
  function escapeHtml(s) {
    return String(s ?? '').replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
  }
  const MONTHS_FULL = ['Январь','Февраль','Март','Апрель','Май','Июнь','Июль','Август','Сентябрь','Октябрь','Ноябрь','Декабрь'];
  const MONTHS_GEN  = ['января','февраля','марта','апреля','мая','июня','июля','августа','сентября','октября','ноября','декабря'];
  const WEEKDAYS_SHORT = ['пн','вт','ср','чт','пт','сб','вс'];
  function pad2(n) { return String(n).padStart(2, '0'); }
  function ymd(d) { return `${d.getFullYear()}-${pad2(d.getMonth()+1)}-${pad2(d.getDate())}`; }
  function parseYmd(s) { const [y,m,dd] = s.split('-').map(Number); return new Date(y, m-1, dd); }
  function startOfDay(d) { const x = new Date(d); x.setHours(0,0,0,0); return x; }
  function startOfMonth(d) { return new Date(d.getFullYear(), d.getMonth(), 1); }
  function endOfMonth(d)   { return new Date(d.getFullYear(), d.getMonth()+1, 0, 23, 59, 59, 999); }
  // Понедельник как первый день недели (ru-RU)
  function startOfWeek(d) {
    const x = startOfDay(d);
    const wd = (x.getDay() + 6) % 7; // 0=пн … 6=вс
    x.setDate(x.getDate() - wd);
    return x;
  }
  function addDays(d, n) { const x = new Date(d); x.setDate(x.getDate()+n); return x; }
  function sameDate(a, b) {
    return a.getFullYear() === b.getFullYear()
        && a.getMonth() === b.getMonth()
        && a.getDate() === b.getDate();
  }
  function timeOf(iso) { const p = mskHM(new Date(iso)); return `${pad2(p.h)}:${pad2(p.m)}`; }
  function endOf(iso, durationMin) {
    const d = new Date(new Date(iso).getTime() + (durationMin || 60) * 60_000);
    const p = mskHM(d);
    return `${pad2(p.h)}:${pad2(p.m)}`;
  }
  function rangeOf(slot) {
    const start = timeOf(slot.busy_at);
    const dur = slot.duration_minutes || 60;
    return `${start}–${endOf(slot.busy_at, dur)}`;
  }
  // Парсит «HH:MM» в минуты с полуночи; возвращает null если невалидно.
  function timeToMinutes(s) {
    const m = /^(\d{2}):(\d{2})$/.exec(s || '');
    if (!m) return null;
    const h = +m[1], mm = +m[2];
    if (h < 0 || h > 23 || mm < 0 || mm > 59) return null;
    return h * 60 + mm;
  }

  function toast(msg) {
    const t = document.getElementById('toast');
    if (!t) { alert(msg); return; }
    t.textContent = msg;
    t.classList.remove('hidden');
    clearTimeout(toast._t);
    toast._t = setTimeout(() => t.classList.add('hidden'), 2400);
  }

  // ---------- Загрузка слотов ----------
  function visibleRange() {
    if (state.view === 'today') {
      const start = startOfDay(state.cursor);
      return { from: start, to: start };
    }
    if (state.view === 'month') {
      // Берём всю сетку месяца (с учётом недельных «хвостов»)
      const ms = startOfMonth(state.cursor);
      const start = startOfWeek(ms);
      const me = endOfMonth(state.cursor);
      // 6 строк × 7 = 42 дня от начала
      const end = addDays(start, 41);
      return { from: start, to: end };
    }
    const start = startOfWeek(state.cursor);
    return { from: start, to: addDays(start, 6) };
  }

  // Загружаем события менеджера на видимый период:
  // (а) личные блокировки manager_busy_slots,
  // (б) встречи из leads (где manager_id = текущий менеджер).
  // Событие — общий формат для рендеров: { id, type, busy_at, duration_minutes, label, _row }.
  async function loadEvents() {
    if (!state.userId) {
      const { data: { user } } = await sb.auth.getUser();
      state.userId = user?.id || null;
    }
    if (!state.userId) return;
    const { from, to } = visibleRange();
    const fromIso = from.toISOString();
    const toIso = addDays(to, 1).toISOString();
    const [blocksRes, leadsRes] = await Promise.all([
      sb.from('manager_busy_slots')
        .select('id, busy_at, duration_minutes, comment')
        .eq('manager_id', state.userId)
        .gte('busy_at', fromIso)
        .lt('busy_at', toIso)
        .order('busy_at'),
      sb.from('leads')
        .select('id, company_name, city, phone, called_phone, lpr_name, meeting_address, meeting_at, comment, has_loyalty, website, telegram, status')
        .eq('manager_id', state.userId)
        .not('meeting_at', 'is', null)
        .gte('meeting_at', fromIso)
        .lt('meeting_at', toIso)
        .order('meeting_at'),
    ]);
    if (blocksRes.error) console.error('blocks:', blocksRes.error);
    if (leadsRes.error) console.error('leads:', leadsRes.error);

    const events = [];
    for (const b of (blocksRes.data || [])) {
      events.push({
        id: 'block-' + b.id,
        _id: b.id,
        type: 'block',
        busy_at: b.busy_at,
        duration_minutes: b.duration_minutes || 60,
        label: b.comment || '— без комментария',
        _row: b,
      });
    }
    for (const l of (leadsRes.data || [])) {
      events.push({
        id: 'lead-' + l.id,
        _id: l.id,
        type: 'lead',
        busy_at: l.meeting_at,
        duration_minutes: 60,
        label: l.company_name || '— без названия',
        _row: l,
      });
    }
    events.sort((a, b) => a.busy_at.localeCompare(b.busy_at));
    state.events = events;
  }

  function eventsForDate(date) {
    // Сравниваем по календарной дате в МСК — иначе в браузерах в +05/+07
    // событие в МСК-вечер может «уехать» на следующий день.
    const dayYmd = ymd(date);
    return state.events.filter((e) => mskYmdOf(new Date(e.busy_at)) === dayYmd);
  }

  // ---------- Точка входа ----------
  async function show() {
    if (!state.initialized) {
      state.initialized = true;
      state.cursor = startOfDay(new Date());
      // Сначала кеш (быстро), потом догружаем из БД.
      state.stepMinutes = loadStepCache();
      state.selectedDay = ymd(state.cursor);
    }
    await refresh();
    // После refresh знаем state.userId — догружаем актуальный шаг
    if (state.userId) {
      const fresh = await loadStepFromDb();
      if (fresh !== state.stepMinutes) {
        state.stepMinutes = fresh;
        saveStepCache(fresh);
        if (state.view === 'today') render();
      }
    }
  }

  async function refresh() {
    const root = $('#section-calendar');
    if (!root) return;
    if (!root.dataset.scaffolded) {
      root.innerHTML = `
        <div class="cal-toolbar">
          <div class="cal-nav">
            <button type="button" class="btn cal-prev" id="cal-prev">‹</button>
            <div class="cal-period" id="cal-period"></div>
            <button type="button" class="btn cal-next" id="cal-next">›</button>
          </div>
          <div class="cal-actions">
            <div class="cal-steps" id="cal-steps">
              <button type="button" class="btn cal-step-btn" data-step="60">1 ч</button>
              <button type="button" class="btn cal-step-btn" data-step="90">1½ ч</button>
            </div>
            <div class="cal-views">
              <button type="button" class="btn cal-view-btn" data-view="today">Сегодня</button>
              <button type="button" class="btn cal-view-btn" data-view="month">Месяц</button>
              <button type="button" class="btn cal-view-btn" data-view="week">Неделя</button>
            </div>
          </div>
        </div>
        <div class="cal-layout">
          <aside class="cal-sidebar" id="cal-sidebar" hidden></aside>
          <div class="cal-body" id="cal-body"></div>
        </div>
      `;
      bindToolbar();
      root.dataset.scaffolded = '1';
    }
    await loadEvents();
    render();
    if (state.selectedDay) renderSidebar();
  }

  function bindToolbar() {
    $('#cal-prev').addEventListener('click', async () => {
      if (state.view === 'today') return; // в режиме «Сегодня» листать нечего
      if (state.view === 'month') {
        state.cursor = new Date(state.cursor.getFullYear(), state.cursor.getMonth() - 1, 1);
      } else {
        state.cursor = addDays(state.cursor, -7);
      }
      await refresh();
    });
    $('#cal-next').addEventListener('click', async () => {
      if (state.view === 'today') return;
      if (state.view === 'month') {
        state.cursor = new Date(state.cursor.getFullYear(), state.cursor.getMonth() + 1, 1);
      } else {
        state.cursor = addDays(state.cursor, 7);
      }
      await refresh();
    });
    document.querySelectorAll('.cal-view-btn').forEach((btn) => {
      btn.addEventListener('click', async () => {
        state.view = btn.dataset.view;
        if (state.view === 'today') {
          state.cursor = startOfDay(new Date());
          state.selectedDay = ymd(state.cursor); // в today всегда сегодня
        }
        state.selectedEventId = null;
        await refresh();
      });
    });
    document.querySelectorAll('.cal-step-btn').forEach((btn) => {
      btn.addEventListener('click', async () => {
        state.stepMinutes = parseInt(btn.dataset.step, 10);
        await saveStepToDb(state.stepMinutes);
        if (state.view === 'today') await refresh();
        else syncStepButtons();
      });
    });
  }

  function syncStepButtons() {
    document.querySelectorAll('.cal-step-btn').forEach((b) => {
      b.classList.toggle('primary', parseInt(b.dataset.step, 10) === state.stepMinutes);
    });
    // Показываем переключатель шага только в режиме Today
    const stepsEl = $('#cal-steps');
    if (stepsEl) stepsEl.style.display = state.view === 'today' ? '' : 'none';
  }

  function render() {
    document.querySelectorAll('.cal-view-btn').forEach((b) => {
      b.classList.toggle('primary', b.dataset.view === state.view);
    });
    syncStepButtons();
    const period = $('#cal-period');
    if (state.view === 'today') {
      const d = state.cursor;
      period.textContent = `${d.getDate()} ${MONTHS_GEN[d.getMonth()]} ${d.getFullYear()}`;
    } else if (state.view === 'month') {
      period.textContent = `${MONTHS_FULL[state.cursor.getMonth()]} ${state.cursor.getFullYear()}`;
    } else {
      const start = startOfWeek(state.cursor);
      const end = addDays(start, 6);
      const sameMonth = start.getMonth() === end.getMonth();
      period.textContent = sameMonth
        ? `${start.getDate()}–${end.getDate()} ${MONTHS_GEN[start.getMonth()]} ${start.getFullYear()}`
        : `${start.getDate()} ${MONTHS_GEN[start.getMonth()]} – ${end.getDate()} ${MONTHS_GEN[end.getMonth()]} ${end.getFullYear()}`;
    }
    // Sidebar (Month/Week) скрываем в режиме Today — там свой layout.
    const layout = document.querySelector('.cal-layout');
    const sidebar = $('#cal-sidebar');
    if (sidebar && state.view === 'today') {
      sidebar.hidden = true;
      sidebar.innerHTML = '';
    }
    // Дополнительно убираем колонку sidebar из grid через class на родителе —
    // надёжнее, чем :has() (поддержка ограничена).
    if (layout) layout.classList.toggle('cal-no-sidebar', state.view === 'today');
    if (state.view === 'today') renderTodayView();
    else if (state.view === 'month') renderMonth();
    else renderWeek();
  }

  function renderMonth() {
    const body = $('#cal-body');
    const ms = startOfMonth(state.cursor);
    const me = endOfMonth(state.cursor);
    const gridStart = startOfWeek(ms);
    const today = startOfDay(new Date());

    let cells = '';
    for (let i = 0; i < 42; i++) {
      const d = addDays(gridStart, i);
      const inMonth = d.getMonth() === ms.getMonth();
      const isToday = sameDate(d, today);
      const events = eventsForDate(d);
      const slotsHtml = events.slice(0, 3).map((s) => `
        <div class="cal-slot-pill cal-slot-${s.type}" title="${escapeHtml(s.label || '')}">${rangeOf(s)} · ${escapeHtml(s.label)}</div>
      `).join('');
      const moreHtml = events.length > 3 ? `<div class="cal-slot-more">+ ещё ${events.length - 3}</div>` : '';
      const dymd = ymd(d);
      const isSelected = state.selectedDay === dymd;
      cells += `
        <div class="cal-cell ${inMonth ? '' : 'cal-cell-out'} ${isToday ? 'cal-cell-today' : ''} ${isSelected ? 'cal-cell-selected' : ''}" data-date="${dymd}">
          <div class="cal-cell-num">${d.getDate()}</div>
          <div class="cal-cell-slots">${slotsHtml}${moreHtml}</div>
        </div>`;
      if (i === 41 && d < me) {
        // Если 6 строк не покрыли весь месяц (бывает редко) — добавим ещё неделю
        // (на 42 ячейки 6 строк × 7 — обычно хватает)
      }
    }
    body.innerHTML = `
      <div class="cal-month-head">${WEEKDAYS_SHORT.map((d) => `<div>${d}</div>`).join('')}</div>
      <div class="cal-month-grid">${cells}</div>`;

    body.querySelectorAll('.cal-cell').forEach((cell) => {
      cell.addEventListener('click', () => selectDay(parseYmd(cell.dataset.date)));
    });
  }

  function renderWeek() {
    const body = $('#cal-body');
    const start = startOfWeek(state.cursor);
    const today = startOfDay(new Date());
    let html = '<div class="cal-week-list">';
    for (let i = 0; i < 7; i++) {
      const d = addDays(start, i);
      const isToday = sameDate(d, today);
      const events = eventsForDate(d);
      const slotsHtml = events.length
        ? events.map((s) => `
            <div class="cal-week-slot cal-slot-${s.type}">
              <span class="cal-week-time">${rangeOf(s)}</span>
              <span class="cal-week-comment">${escapeHtml(s.label)}</span>
            </div>`).join('')
        : '<div class="cal-week-empty">— свободен</div>';
      const dymd = ymd(d);
      const isSelected = state.selectedDay === dymd;
      html += `
        <div class="cal-week-row ${isToday ? 'cal-week-row-today' : ''} ${isSelected ? 'cal-week-row-selected' : ''}" data-date="${dymd}">
          <div class="cal-week-day">
            <div class="cal-week-num">${d.getDate()}</div>
            <div class="cal-week-wd">${WEEKDAYS_SHORT[i]}</div>
          </div>
          <div class="cal-week-slots">${slotsHtml}</div>
          <button type="button" class="btn cal-week-add" data-date="${dymd}">＋</button>
        </div>`;
    }
    html += '</div>';
    body.innerHTML = html;

    body.querySelectorAll('.cal-week-add').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        openDayModal(parseYmd(btn.dataset.date));
      });
    });
    body.querySelectorAll('.cal-week-row').forEach((row) => {
      row.addEventListener('click', () => selectDay(parseYmd(row.dataset.date)));
    });
  }

  // ---------- Режим «Сегодня» — почасовая лента + детали справа ----------
  function renderTodayView() {
    const body = $('#cal-body');
    if (!body) return;
    const date = state.cursor;
    const events = eventsForDate(date);

    // Генерируем слоты по выбранному шагу. Для каждого считаем, какие
    // events пересекаются с интервалом [slotStart, slotEnd).
    const stepM = state.stepMinutes || 60;
    const fromM = HOUR_FROM * 60;
    const toM = HOUR_TO * 60;

    const eventOf = (e) => {
      const start = new Date(e.busy_at);
      const sH = mskHM(start);
      const startM = sH.h * 60 + sH.m;
      const endM = startM + (e.duration_minutes || 60);
      return { startM, endM, e };
    };
    const eventsM = events.map(eventOf);

    const slotsHtml = [];
    for (let m = fromM; m < toM; m += stepM) {
      const slotStart = m;
      const slotEnd = m + stepM;
      const overlap = eventsM.filter((x) => x.endM > slotStart && x.startM < slotEnd);
      const timeLabel = `${pad2(Math.floor(m/60))}:${pad2(m % 60)}`;
      if (overlap.length) {
        // Если несколько событий накладываются — рисуем все подряд
        const cells = overlap.map(({ e }) => {
          const isActive = state.selectedEventId === e.id;
          const cls = `cal-tslot cal-tslot-${e.type}${isActive ? ' cal-tslot-active' : ''}`;
          return `<button type="button" class="${cls}" data-event-id="${e.id}">
            <span class="cal-tslot-time">${rangeOf(e)}</span>
            <span class="cal-tslot-label">${escapeHtml(e.label)}</span>
          </button>`;
        }).join('');
        slotsHtml.push(`<div class="cal-trow"><div class="cal-trow-time">${timeLabel}</div><div class="cal-trow-cells">${cells}</div></div>`);
      } else {
        slotsHtml.push(`<div class="cal-trow"><div class="cal-trow-time">${timeLabel}</div><div class="cal-trow-cells"><div class="cal-tslot cal-tslot-free">— свободно</div></div></div>`);
      }
    }

    body.innerHTML = `
      <div class="cal-today">
        <div class="cal-today-grid">
          <div class="cal-today-head">
            <span>План на сегодня</span>
            <button type="button" class="btn cal-today-add" id="cal-today-add">＋ Событие</button>
          </div>
          ${slotsHtml.join('')}
        </div>
        <aside class="cal-today-side" id="cal-today-side">${renderTodayDetails()}</aside>
      </div>`;

    body.querySelectorAll('.cal-tslot[data-event-id]').forEach((el) => {
      el.addEventListener('click', () => {
        state.selectedEventId = el.dataset.eventId;
        body.querySelectorAll('.cal-tslot-active').forEach((a) => a.classList.remove('cal-tslot-active'));
        el.classList.add('cal-tslot-active');
        $('#cal-today-side').innerHTML = renderTodayDetails();
        bindTodayDetailsActions();
      });
    });
    $('#cal-today-add')?.addEventListener('click', () => openDayModal(date));
    bindTodayDetailsActions();
  }

  function renderTodayDetails() {
    if (!state.selectedEventId) {
      return `<div class="cal-today-empty">Выберите событие слева — здесь появятся детали (компания, контакты, адрес, комментарий).</div>`;
    }
    const ev = state.events.find((e) => e.id === state.selectedEventId);
    if (!ev) return `<div class="cal-today-empty">Событие не найдено — обновите страницу.</div>`;
    return renderEventDetails(ev);
  }

  function bindTodayDetailsActions() {
    $('#cal-today-side .cal-side-del')?.addEventListener('click', async (e) => {
      const id = e.currentTarget.dataset.id;
      const ok = window.confirmDialog
        ? await window.confirmDialog({ title: 'Удалить событие?', okText: 'Удалить', cancelText: 'Отмена', danger: true })
        : confirm('Удалить событие?');
      if (!ok) return;
      const { error } = await sb.from('manager_busy_slots').delete().eq('id', id);
      if (error) { toast('Не получилось удалить.'); return; }
      state.selectedEventId = null;
      await loadEvents();
      render();
      toast('Событие удалено.');
    });
  }

  // ---------- Модалка добавления блокировки ----------
  // Список слотов и удаление вынесены в sidebar (renderSidebar).
  function openDayModal(date) {
    const backdrop = document.createElement('div');
    backdrop.className = 'modal-backdrop cal-modal';
    backdrop.style.zIndex = '9999';
    backdrop.innerHTML = `
      <div class="modal-window cal-day-window" role="dialog" aria-modal="true">
        <h3 class="modal-title">Добавить событие —${escapeHtml(date.getDate() + ' ' + MONTHS_GEN[date.getMonth()] + ' ' + date.getFullYear())}</h3>
        <form class="cal-day-add" id="cal-day-add" autocomplete="off">
          <div class="cal-day-add-row">
            <label class="cal-day-add-time">
              <span class="ol-label">С</span>
              <input type="time" name="time_from" required>
            </label>
            <label class="cal-day-add-time">
              <span class="ol-label">До</span>
              <input type="time" name="time_to" required>
            </label>
            <label class="cal-day-add-comment">
              <span class="ol-label">Комментарий</span>
              <input type="text" name="comment" maxlength="240" placeholder="Например: личное">
            </label>
          </div>
          <div class="cal-day-actions">
            <button type="button" class="btn" data-act="close">Отмена</button>
            <button type="submit" class="btn primary">Добавить</button>
          </div>
        </form>
      </div>`;
    document.body.appendChild(backdrop);

    backdrop.addEventListener('click', (e) => {
      if (e.target === backdrop || e.target.dataset?.act === 'close') backdrop.remove();
    });
    backdrop.querySelector('#cal-day-add').addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const tFrom = (fd.get('time_from') || '').trim();
      const tTo = (fd.get('time_to') || '').trim();
      const comment = (fd.get('comment') || '').trim() || null;
      const fromMin = timeToMinutes(tFrom);
      const toMin = timeToMinutes(tTo);
      if (fromMin === null) { toast('Укажите время начала.'); return; }
      if (toMin === null) { toast('Укажите время окончания.'); return; }
      if (toMin <= fromMin) { toast('Время «до» должно быть позже времени «с».'); return; }
      const duration = toMin - fromMin;
      // Время вводится в МСК → переводим в UTC ISO с явным +03:00.
      const iso = new Date(mskToUtcIso(ymd(date), tFrom)).toISOString();
      const { error } = await sb.from('manager_busy_slots').insert({
        manager_id: state.userId,
        busy_at: iso,
        duration_minutes: duration,
        comment,
      });
      if (error) {
        console.error('insert busy:', error);
        toast('Не получилось сохранить.');
        return;
      }
      backdrop.remove();
      await loadEvents();
      render();
      if (state.view !== 'today') {
        if (state.selectedDay === ymd(date)) renderSidebar();
        else selectDay(date);
      }
      toast('Слот добавлен.');
    });
  }

  // ---------- Sidebar выбранного дня ----------
  function selectDay(date) {
    state.selectedDay = ymd(date);
    state.selectedEventId = null;
    // Перерисовать grid с подсветкой выбранного дня
    render();
    renderSidebar();
  }

  function renderSidebar() {
    const aside = $('#cal-sidebar');
    if (!aside) return;
    if (!state.selectedDay) { aside.hidden = true; aside.innerHTML = ''; return; }
    aside.hidden = false;
    const date = parseYmd(state.selectedDay);
    const events = eventsForDate(date);

    const headerHtml = `
      <div class="cal-side-head">
        <div>
          <div class="cal-side-day">${date.getDate()} ${MONTHS_GEN[date.getMonth()]} ${date.getFullYear()}</div>
          <div class="cal-side-count">${events.length ? events.length + ' событ.' : 'нет событий'}</div>
        </div>
        <button type="button" class="btn cal-side-close" id="cal-side-close" title="Скрыть панель">×</button>
      </div>`;

    const listHtml = events.length
      ? `<ul class="cal-side-list">
          ${events.map((e) => `
            <li class="cal-side-item cal-slot-${e.type} ${state.selectedEventId === e.id ? 'cal-side-active' : ''}" data-event-id="${e.id}">
              <div class="cal-side-time">${rangeOf(e)}</div>
              <div class="cal-side-label">${escapeHtml(e.label)}</div>
              <div class="cal-side-tag">${e.type === 'lead' ? 'встреча' : 'блок'}</div>
            </li>
          `).join('')}
        </ul>`
      : '<div class="cal-side-empty">На этот день встреч и блокировок нет.</div>';

    let detailsHtml = '';
    if (state.selectedEventId) {
      const ev = events.find((e) => e.id === state.selectedEventId);
      if (ev) detailsHtml = renderEventDetails(ev);
    }

    const addBtnHtml = `<button type="button" class="btn primary cal-side-add" id="cal-side-add">＋ Добавить событие</button>`;

    aside.innerHTML = headerHtml + listHtml + detailsHtml + addBtnHtml;

    $('#cal-side-close').addEventListener('click', () => {
      state.selectedDay = null;
      state.selectedEventId = null;
      aside.hidden = true;
      render();
    });
    $('#cal-side-add').addEventListener('click', () => openDayModal(date));

    aside.querySelectorAll('.cal-side-item').forEach((el) => {
      el.addEventListener('click', () => {
        state.selectedEventId = el.dataset.eventId;
        renderSidebar();
      });
    });

    aside.querySelector('.cal-side-del')?.addEventListener('click', async (e) => {
      const id = e.currentTarget.dataset.id;
      const ok = window.confirmDialog
        ? await window.confirmDialog({ title: 'Удалить событие?', okText: 'Удалить', cancelText: 'Отмена', danger: true })
        : confirm('Удалить событие?');
      if (!ok) return;
      const { error } = await sb.from('manager_busy_slots').delete().eq('id', id);
      if (error) { toast('Не получилось удалить.'); return; }
      state.selectedEventId = null;
      await loadEvents();
      render();
      renderSidebar();
      toast('Событие удалено.');
    });
  }

  function renderEventDetails(ev) {
    if (ev.type === 'block') {
      const r = ev._row;
      return `<div class="cal-side-details cal-side-details-block">
        <div class="cal-side-details-head">
          <strong>Личное событие</strong>
          <button class="btn cal-side-del danger" data-id="${ev._id}" type="button">🗑 Удалить</button>
        </div>
        <div class="cal-side-row"><span>Время:</span> ${rangeOf(ev)}</div>
        <div class="cal-side-row"><span>Комментарий:</span> ${escapeHtml(r.comment || '— без комментария')}</div>
      </div>`;
    }
    const r = ev._row;
    const tel = r.phone ? `<a href="tel:${escapeHtml(r.phone.replace(/[^\d+]/g, ''))}">${escapeHtml(r.phone)}</a>` : '— нет';
    return `<div class="cal-side-details cal-side-details-lead">
      <div class="cal-side-details-head">
        <strong>${escapeHtml(r.company_name)}</strong>
        <a class="cal-side-link" href="seller#leads">«Мои лиды» →</a>
      </div>
      <div class="cal-side-row"><span>Время:</span> ${rangeOf(ev)}</div>
      ${r.city ? `<div class="cal-side-row"><span>Город:</span> ${escapeHtml(r.city)}</div>` : ''}
      ${r.meeting_address ? `<div class="cal-side-row"><span>Адрес:</span> ${escapeHtml(r.meeting_address)}</div>` : ''}
      <div class="cal-side-row"><span>Телефон:</span> ${tel}</div>
      ${r.lpr_name ? `<div class="cal-side-row"><span>ЛПР:</span> ${escapeHtml(r.lpr_name)}</div>` : ''}
      ${r.comment ? `<div class="cal-side-row cal-side-row-comment"><span>Комментарий:</span> ${escapeHtml(r.comment)}</div>` : ''}
    </div>`;
  }

  window.sellerCalendar = { show, refresh };
})();
