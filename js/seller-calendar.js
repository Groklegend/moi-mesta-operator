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
    slots: [],              // [{id, busy_at, duration_minutes, comment}] на видимый период
    initialized: false,
    userId: null,
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

  async function loadSlots() {
    if (!state.userId) {
      const { data: { user } } = await sb.auth.getUser();
      state.userId = user?.id || null;
    }
    if (!state.userId) return;
    const { from, to } = visibleRange();
    const { data, error } = await sb
      .from('manager_busy_slots')
      .select('id, busy_at, duration_minutes, comment')
      .eq('manager_id', state.userId)
      .gte('busy_at', from.toISOString())
      .lt('busy_at', addDays(to, 1).toISOString())
      .order('busy_at');
    if (error) { console.error('busy_slots:', error); state.slots = []; return; }
    state.slots = data || [];
  }

  function slotsForDate(date) {
    return state.slots.filter((s) => sameDate(new Date(s.busy_at), date))
      .sort((a, b) => a.busy_at.localeCompare(b.busy_at));
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
            <button type="button" class="btn cal-today" id="cal-today">Сегодня</button>
          </div>
          <div class="cal-views">
            <button type="button" class="btn cal-view-btn" data-view="month">Месяц</button>
            <button type="button" class="btn cal-view-btn" data-view="week">Неделя</button>
          </div>
        </div>
        <div class="cal-body" id="cal-body"></div>
        <p class="cal-hint">Кликните на день, чтобы добавить занятый слот. Эти блокировки видит оператор при назначении встречи.</p>
      `;
      bindToolbar();
      root.dataset.scaffolded = '1';
    }
    await loadSlots();
    render();
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
      const slots = slotsForDate(d);
      const slotsHtml = slots.slice(0, 3).map((s) => `
        <div class="cal-slot-pill" title="${escapeHtml(s.comment || '')}">${timeOf(s.busy_at)}${s.comment ? ' · ' + escapeHtml(s.comment) : ''}</div>
      `).join('');
      const moreHtml = slots.length > 3 ? `<div class="cal-slot-more">+ ещё ${slots.length - 3}</div>` : '';
      cells += `
        <div class="cal-cell ${inMonth ? '' : 'cal-cell-out'} ${isToday ? 'cal-cell-today' : ''}" data-date="${ymd(d)}">
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
      cell.addEventListener('click', () => openDayModal(parseYmd(cell.dataset.date)));
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
      const slots = slotsForDate(d);
      const slotsHtml = slots.length
        ? slots.map((s) => `
            <div class="cal-week-slot">
              <span class="cal-week-time">${timeOf(s.busy_at)}</span>
              <span class="cal-week-comment">${escapeHtml(s.comment || '— без комментария')}</span>
            </div>`).join('')
        : '<div class="cal-week-empty">— свободен</div>';
      html += `
        <div class="cal-week-row ${isToday ? 'cal-week-row-today' : ''}" data-date="${ymd(d)}">
          <div class="cal-week-day">
            <div class="cal-week-num">${d.getDate()}</div>
            <div class="cal-week-wd">${WEEKDAYS_SHORT[i]}</div>
          </div>
          <div class="cal-week-slots">${slotsHtml}</div>
          <button type="button" class="btn cal-week-add" data-date="${ymd(d)}">＋</button>
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
      row.addEventListener('click', () => openDayModal(parseYmd(row.dataset.date)));
    });
  }

  // ---------- Модалка дня ----------
  function openDayModal(date) {
    const slots = slotsForDate(date);

    const backdrop = document.createElement('div');
    backdrop.className = 'modal-backdrop cal-modal';
    backdrop.style.zIndex = '9999';
    backdrop.innerHTML = `
      <div class="modal-window cal-day-window" role="dialog" aria-modal="true">
        <h3 class="modal-title">${escapeHtml(date.getDate() + ' ' + MONTHS_GEN[date.getMonth()] + ' ' + date.getFullYear())}</h3>

        <div class="cal-day-list" id="cal-day-list">${renderDaySlots(slots)}</div>

        <form class="cal-day-add" id="cal-day-add" autocomplete="off">
          <div class="cal-day-add-row">
            <label class="cal-day-add-time">
              <span class="ol-label">Время</span>
              <input type="time" name="time" required>
            </label>
            <label class="cal-day-add-comment">
              <span class="ol-label">Комментарий</span>
              <input type="text" name="comment" maxlength="240" placeholder="Например: личное">
            </label>
          </div>
          <div class="cal-day-actions">
            <button type="button" class="btn" data-act="close">Закрыть</button>
            <button type="submit" class="btn primary">Добавить слот</button>
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
      const t = (fd.get('time') || '').trim();
      const comment = (fd.get('comment') || '').trim() || null;
      if (!t) { toast('Укажите время.'); return; }
      const iso = new Date(`${ymd(date)}T${t}`).toISOString();
      const { error } = await sb.from('manager_busy_slots').insert({
        manager_id: state.userId,
        busy_at: iso,
        comment,
      });
      if (error) {
        console.error('insert busy:', error);
        toast('Не получилось сохранить.');
        return;
      }
      await loadSlots();
      // Перерисовать список в открытой модалке + календарь под ней
      $('#cal-day-list').innerHTML = renderDaySlots(slotsForDate(date));
      bindDeleteHandlers(date);
      e.target.reset();
      render();
      toast('Слот добавлен.');
    });
    bindDeleteHandlers(date);

    function bindDeleteHandlers(d) {
      backdrop.querySelectorAll('.cal-day-slot-del').forEach((btn) => {
        btn.addEventListener('click', async () => {
          const id = btn.dataset.id;
          const ok = window.confirmDialog
            ? await window.confirmDialog({ title: 'Удалить слот?', okText: 'Удалить', cancelText: 'Отмена', danger: true })
            : confirm('Удалить слот?');
          if (!ok) return;
          const { error } = await sb.from('manager_busy_slots').delete().eq('id', id);
          if (error) { toast('Не получилось удалить.'); return; }
          await loadSlots();
          $('#cal-day-list').innerHTML = renderDaySlots(slotsForDate(d));
          bindDeleteHandlers(d);
          render();
          toast('Слот удалён.');
        });
      });
    }
  }

  function renderDaySlots(slots) {
    if (!slots.length) {
      return '<div class="cal-day-empty">На этот день блокировок нет. Добавьте первую ниже.</div>';
    }
    return `<ul class="cal-day-slots">
      ${slots.map((s) => `
        <li class="cal-day-slot">
          <span class="cal-day-slot-time">${timeOf(s.busy_at)}</span>
          <span class="cal-day-slot-comment">${escapeHtml(s.comment || '— без комментария')}</span>
          <button type="button" class="cal-day-slot-del" data-id="${s.id}" title="Удалить">🗑</button>
        </li>
      `).join('')}
    </ul>`;
  }

  window.sellerCalendar = { show, refresh };
})();
