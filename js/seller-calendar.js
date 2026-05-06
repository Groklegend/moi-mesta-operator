// Раздел «Календарь» в кабинете менеджера.
// Менеджер сам отмечает занятые слоты (личные дела, обучение, встречи
// вне Хаба). Оператор в «Заявке Плюс» видит эти блокировки в правой
// панели расписания вместе со встречами из таблицы leads — общий
// список занятости через RPC get_busy_slots.

(function () {
  'use strict';

  const $ = (sel, el = document) => el.querySelector(sel);

  const state = {
    view: 'month',          // 'month' | 'week'
    cursor: null,           // Date — опорная дата (любой день внутри периода)
    events: [],             // объединённый список событий (leads + blocks) на видимый период
    initialized: false,
    userId: null,
    selectedDay: null,      // 'YYYY-MM-DD' — выбранный день для sidebar
    selectedEventId: null,  // id выбранной карточки в sidebar
  };

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
  function timeOf(iso) { const d = new Date(iso); return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`; }
  function endOf(iso, durationMin) {
    const d = new Date(new Date(iso).getTime() + (durationMin || 60) * 60_000);
    return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
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
    return state.events.filter((e) => sameDate(new Date(e.busy_at), date));
  }

  // ---------- Точка входа ----------
  async function show() {
    if (!state.initialized) {
      state.initialized = true;
      state.cursor = startOfDay(new Date());
    }
    await refresh();
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
            <button type="button" class="btn cal-today" id="cal-today">Сегодня</button>
            <div class="cal-views">
              <button type="button" class="btn cal-view-btn" data-view="month">Месяц</button>
              <button type="button" class="btn cal-view-btn" data-view="week">Неделя</button>
            </div>
          </div>
        </div>
        <div class="cal-layout">
          <aside class="cal-sidebar" id="cal-sidebar" hidden></aside>
          <div class="cal-body" id="cal-body"></div>
        </div>
        <p class="cal-hint">Кликните на день — слева появятся встречи и блокировки этого дня. Клик на слот раскрывает подробности.</p>
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
      if (state.view === 'month') {
        state.cursor = new Date(state.cursor.getFullYear(), state.cursor.getMonth() - 1, 1);
      } else {
        state.cursor = addDays(state.cursor, -7);
      }
      await refresh();
    });
    $('#cal-next').addEventListener('click', async () => {
      if (state.view === 'month') {
        state.cursor = new Date(state.cursor.getFullYear(), state.cursor.getMonth() + 1, 1);
      } else {
        state.cursor = addDays(state.cursor, 7);
      }
      await refresh();
    });
    $('#cal-today').addEventListener('click', async () => {
      state.cursor = startOfDay(new Date());
      await refresh();
    });
    document.querySelectorAll('.cal-view-btn').forEach((btn) => {
      btn.addEventListener('click', async () => {
        state.view = btn.dataset.view;
        await refresh();
      });
    });
  }

  function render() {
    document.querySelectorAll('.cal-view-btn').forEach((b) => {
      b.classList.toggle('primary', b.dataset.view === state.view);
    });
    const period = $('#cal-period');
    if (state.view === 'month') {
      period.textContent = `${MONTHS_FULL[state.cursor.getMonth()]} ${state.cursor.getFullYear()}`;
    } else {
      const start = startOfWeek(state.cursor);
      const end = addDays(start, 6);
      const sameMonth = start.getMonth() === end.getMonth();
      period.textContent = sameMonth
        ? `${start.getDate()}–${end.getDate()} ${MONTHS_GEN[start.getMonth()]} ${start.getFullYear()}`
        : `${start.getDate()} ${MONTHS_GEN[start.getMonth()]} – ${end.getDate()} ${MONTHS_GEN[end.getMonth()]} ${end.getFullYear()}`;
    }
    if (state.view === 'month') renderMonth();
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

  // ---------- Модалка добавления блокировки ----------
  // Список слотов и удаление вынесены в sidebar (renderSidebar).
  function openDayModal(date) {
    const backdrop = document.createElement('div');
    backdrop.className = 'modal-backdrop cal-modal';
    backdrop.style.zIndex = '9999';
    backdrop.innerHTML = `
      <div class="modal-window cal-day-window" role="dialog" aria-modal="true">
        <h3 class="modal-title">Добавить блокировку — ${escapeHtml(date.getDate() + ' ' + MONTHS_GEN[date.getMonth()] + ' ' + date.getFullYear())}</h3>
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
      const iso = new Date(`${ymd(date)}T${tFrom}`).toISOString();
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
      // Если этот день уже выбран в sidebar — обновим
      if (state.selectedDay === ymd(date)) renderSidebar();
      else selectDay(date);
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

    const addBtnHtml = `<button type="button" class="btn primary cal-side-add" id="cal-side-add">＋ Добавить блокировку</button>`;

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
        ? await window.confirmDialog({ title: 'Удалить блокировку?', okText: 'Удалить', cancelText: 'Отмена', danger: true })
        : confirm('Удалить блокировку?');
      if (!ok) return;
      const { error } = await sb.from('manager_busy_slots').delete().eq('id', id);
      if (error) { toast('Не получилось удалить.'); return; }
      state.selectedEventId = null;
      await loadEvents();
      render();
      renderSidebar();
      toast('Блокировка удалена.');
    });
  }

  function renderEventDetails(ev) {
    if (ev.type === 'block') {
      const r = ev._row;
      return `<div class="cal-side-details cal-side-details-block">
        <div class="cal-side-details-head">
          <strong>Личная блокировка</strong>
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
