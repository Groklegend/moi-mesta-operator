// Раздел «Заявка Плюс» в кабинете оператора.
// Список заявок и inline-форма создания (без модалки) — слева форма,
// справа расписание менеджеров на выбранный день. По «Сохранить» лид
// уходит выбранному менеджеру и появляется у него в seller.html
// → «Мои лиды». Поля pitch/recommendations наполнит позже Гари.

(function () {
  'use strict';

  const $ = (sel, el = document) => el.querySelector(sel);

  const state = {
    leads: [],
    managers: [],
    initialized: false,
    view: 'list',          // 'list' | 'create'
    calView: 'day',        // 'day' | 'week' — режим правой панели расписания
    busySlots: [],         // на текущий день (calView='day')
    busyWeek: {},          // { 'YYYY-MM-DD': [...] } на неделю (calView='week')
  };

  const HOUR_FROM = 9;     // рабочий день для почасовой сетки
  const HOUR_TO = 19;

  // ---------- Утилиты ----------
  function escapeHtml(s) {
    return String(s ?? '').replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
  }

  const MONTHS_SHORT = ['янв','фев','мар','апр','мая','июн','июл','авг','сен','окт','ноя','дек'];
  const MONTHS_FULL = ['января','февраля','марта','апреля','мая','июня','июля','августа','сентября','октября','ноября','декабря'];
  const WEEKDAYS_FULL = ['воскресенье','понедельник','вторник','среда','четверг','пятница','суббота'];

  function pad2(n) { return String(n).padStart(2, '0'); }

  function ymdLocal(d) {
    return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
  }
  function parseYmd(s) {
    const [y, m, dd] = s.split('-').map(Number);
    return new Date(y, m - 1, dd);
  }
  function formatMeetingShort(iso) {
    if (!iso) return '— дата не указана';
    const d = new Date(iso);
    return `${d.getDate()} ${MONTHS_SHORT[d.getMonth()]}, ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
  }
  function formatDayHeader(ymd) {
    if (!ymd) return '';
    const d = parseYmd(ymd);
    return `${d.getDate()} ${MONTHS_FULL[d.getMonth()]} ${d.getFullYear()}, ${WEEKDAYS_FULL[d.getDay()]}`;
  }

  function toast(msg) {
    const t = document.getElementById('toast');
    if (!t) { alert(msg); return; }
    t.textContent = msg;
    t.classList.remove('hidden');
    clearTimeout(toast._t);
    toast._t = setTimeout(() => t.classList.add('hidden'), 2400);
  }

  function getManagerName(id) {
    if (!id) return '— без менеджера';
    const m = state.managers.find((x) => x.id === id);
    if (!m) return '— менеджер удалён';
    return m.full_name && m.full_name.trim() ? m.full_name : m.email;
  }

  // ---------- Загрузка данных ----------
  async function loadData() {
    const [leadsRes, mgrsRes] = await Promise.all([
      sb.from('leads')
        .select('id, company_name, city, manager_id, meeting_at, created_at, status')
        .order('created_at', { ascending: false }),
      sb.from('users')
        .select('id, full_name, email, status')
        .contains('roles', ['seller'])
        .order('full_name'),
    ]);
    if (leadsRes.error) console.error('leads:', leadsRes.error);
    if (mgrsRes.error) console.error('managers:', mgrsRes.error);
    state.leads = leadsRes.data || [];
    state.managers = (mgrsRes.data || []).filter((u) => u.status !== 'disabled');
  }

  async function loadBusySlots(ymd) {
    if (!ymd) { state.busySlots = []; return; }
    const { data, error } = await sb.rpc('get_busy_slots', { d: ymd });
    if (error) {
      console.error('get_busy_slots:', error);
      state.busySlots = [];
      return;
    }
    state.busySlots = data || [];
  }

  async function loadBusyWeek(startYmd) {
    state.busyWeek = {};
    const start = parseYmd(startYmd);
    const days = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date(start); d.setDate(d.getDate() + i);
      days.push(ymdLocal(d));
    }
    const results = await Promise.all(days.map((ymd) =>
      sb.rpc('get_busy_slots', { d: ymd }).then((r) => ({ ymd, data: r.data || [], error: r.error }))
    ));
    for (const r of results) {
      if (r.error) console.error('get_busy_slots ' + r.ymd + ':', r.error);
      state.busyWeek[r.ymd] = r.data;
    }
  }

  // Получить выбранного в форме менеджера (id) — для фильтра расписания.
  function selectedManagerId() {
    const sel = document.querySelector('select[name="manager_id"]');
    return sel?.value || '';
  }

  // ---------- Точка входа ----------
  async function show() {
    const pane = $('#leads-plus-pane');
    if (!pane) return;
    if (!state.initialized) {
      pane.innerHTML = '<div class="ol-loading">Загрузка…</div>';
      await loadData();
      state.initialized = true;
    }
    if (state.view === 'create') renderCreate();
    else renderList();
  }

  // ---------- Список заявок ----------
  function renderList() {
    state.view = 'list';
    const pane = $('#leads-plus-pane');
    pane.innerHTML = `
      <div class="ol-wrap">
        <div class="ol-header">
          <div>
            <h2 class="ol-title">Заявка Плюс</h2>
            <p class="ol-sub">Карточки клиентов после холодного звонка. Передаются менеджеру и попадают в его раздел «Мои лиды».</p>
          </div>
          <button class="btn primary ol-add" type="button" id="ol-add-btn">＋ Новая заявка</button>
        </div>
        <div class="ol-list">${renderListItems()}</div>
      </div>`;
    $('#ol-add-btn').addEventListener('click', () => {
      state.view = 'create';
      renderCreate();
    });
  }

  function renderListItems() {
    if (!state.leads.length) {
      return '<div class="ol-empty">Заявок пока нет. Нажмите «＋ Новая заявка», чтобы создать первую.</div>';
    }
    return state.leads.map((lead) => `
      <div class="ol-card">
        <div class="ol-card-main">
          <div class="ol-card-title">${escapeHtml(lead.company_name)}</div>
          <div class="ol-card-meta">
            <span class="ol-card-city">${escapeHtml(lead.city || '— город не указан')}</span>
            <span class="ol-card-meet">${escapeHtml(formatMeetingShort(lead.meeting_at))}</span>
          </div>
        </div>
        <div class="ol-card-mgr">
          <span class="ol-card-mgr-label">Менеджер:</span>
          <span class="ol-card-mgr-name">${escapeHtml(getManagerName(lead.manager_id))}</span>
        </div>
      </div>`).join('');
  }

  // ---------- View «Создание заявки» ----------
  async function renderCreate() {
    state.view = 'create';
    const pane = $('#leads-plus-pane');

    if (!state.managers.length) {
      pane.innerHTML = `
        <div class="ol-wrap">
          <button class="ol-back-btn" type="button" id="ol-back">← К списку</button>
          <div class="ol-empty">Нет активных менеджеров. Попросите коммерческого добавить хотя бы одного.</div>
        </div>`;
      $('#ol-back').addEventListener('click', () => renderList());
      return;
    }

    const todayYmd = ymdLocal(new Date());

    pane.innerHTML = `
      <div class="ol-wrap ol-create">
        <button class="ol-back-btn" type="button" id="ol-back">← К списку</button>
        <div class="ol-create-grid">
          <div class="ol-create-col-left">
            <h2 class="ol-title">Новая заявка</h2>
            <form class="ol-form" id="ol-form" autocomplete="off">
              <div class="ol-grid">
                <label class="ol-field ol-field-wide">
                  <span class="ol-label">Название компании <em>*</em></span>
                  <input type="text" name="company_name" required maxlength="120">
                </label>

                <label class="ol-field ol-field-wide">
                  <span class="ol-label">Город</span>
                  <input type="text" name="city" maxlength="80">
                </label>

                <label class="ol-field ol-field-wide ol-field-checkbox">
                  <input type="checkbox" name="is_online" id="ol-is-online">
                  <span>Онлайн-встреча (без адреса)</span>
                </label>

                <div class="ol-field ol-field-wide ol-address-wrap">
                  <span class="ol-label">Адрес встречи</span>
                  <input type="text" name="meeting_address" id="ol-address" maxlength="240" placeholder="Город, улица, дом, офис…">
                  <div class="dadata-suggest ol-suggest" id="ol-suggest" hidden></div>
                </div>

                <div class="ol-field">
                  <span class="ol-label">Дата встречи</span>
                  <div class="ol-date-control">
                    <button type="button" class="ol-date-arrow" data-shift="-1" aria-label="Предыдущий день">‹</button>
                    <input type="date" name="meeting_date" id="ol-meeting-date" value="${todayYmd}">
                    <button type="button" class="ol-date-arrow" data-shift="1" aria-label="Следующий день">›</button>
                  </div>
                </div>

                <label class="ol-field">
                  <span class="ol-label">Время встречи</span>
                  <input type="time" name="meeting_time">
                </label>

                <label class="ol-field">
                  <span class="ol-label">Телефон клиента</span>
                  <input type="text" name="phone" maxlength="40" placeholder="+7 (___) ___-__-__">
                </label>

                <label class="ol-field">
                  <span class="ol-label">Номер, на который звонили</span>
                  <input type="text" name="called_phone" maxlength="40">
                </label>

                <label class="ol-field ol-field-wide">
                  <span class="ol-label">Сайт</span>
                  <input type="text" name="website" maxlength="200" placeholder="https://...">
                </label>

                <label class="ol-field ol-field-wide">
                  <span class="ol-label">ФИО ЛПР</span>
                  <input type="text" name="lpr_name" maxlength="120" placeholder="Имя, должность">
                </label>

                <label class="ol-field ol-field-wide ol-field-checkbox">
                  <input type="checkbox" name="has_loyalty">
                  <span>Есть программа лояльности</span>
                </label>

                <label class="ol-field ol-field-wide">
                  <span class="ol-label">Комментарий</span>
                  <textarea name="comment" rows="3" maxlength="2000" placeholder="Что обсудили, особенности клиента, договорённости…"></textarea>
                </label>

                <label class="ol-field ol-field-wide">
                  <span class="ol-label">Менеджер <em>*</em></span>
                  <select name="manager_id" required>
                    <option value="">— выберите менеджера —</option>
                    ${state.managers.map((m) => `
                      <option value="${m.id}">${escapeHtml((m.full_name || '').trim() || m.email)}</option>
                    `).join('')}
                  </select>
                </label>
              </div>

              <div class="ol-actions">
                <button type="button" class="btn" id="ol-cancel">Отмена</button>
                <button type="submit" class="btn primary" id="ol-submit">Сохранить и передать менеджеру</button>
              </div>
            </form>
          </div>

          <aside class="ol-create-col-right">
            <div class="ol-cal-head">
              <h3 class="ol-cal-title">Расписание менеджера</h3>
              <div class="ol-cal-views">
                <button type="button" class="ol-cal-view-btn primary" data-cv="day">День</button>
                <button type="button" class="ol-cal-view-btn" data-cv="week">Неделя</button>
              </div>
            </div>
            <div class="ol-cal-period" id="ol-cal-period">${escapeHtml(formatDayHeader(todayYmd))}</div>
            <div class="ol-cal-body" id="ol-cal-body">
              <div class="ol-cal-loading">Загрузка…</div>
            </div>
            <p class="ol-cal-hint">Кликните на свободный час — время автоматически подставится в форме.</p>
          </aside>
        </div>
      </div>`;

    $('#ol-back').addEventListener('click', () => renderList());
    $('#ol-cancel').addEventListener('click', () => renderList());
    $('#ol-form').addEventListener('submit', (e) => {
      e.preventDefault();
      saveForm(e.target);
    });

    bindDateControl();
    bindOnlineCheckbox();
    bindAddressAutocomplete();
    bindCalendarViews();
    bindManagerSelectChange();

    // Календарь на сегодня
    await refreshCalendar(todayYmd);

    $('input[name="company_name"]')?.focus();
  }

  function bindDateControl() {
    const dateInput = $('#ol-meeting-date');
    document.querySelectorAll('.ol-date-arrow').forEach((btn) => {
      btn.addEventListener('click', () => {
        const days = parseInt(btn.dataset.shift, 10) || 0;
        const cur = dateInput.value ? parseYmd(dateInput.value) : new Date();
        cur.setDate(cur.getDate() + days);
        dateInput.value = ymdLocal(cur);
        refreshCalendar(dateInput.value);
      });
    });
    dateInput.addEventListener('change', () => refreshCalendar(dateInput.value));
  }

  function bindOnlineCheckbox() {
    const cb = $('#ol-is-online');
    const addr = $('#ol-address');
    const wrap = document.querySelector('.ol-address-wrap');
    cb.addEventListener('change', () => {
      addr.disabled = cb.checked;
      if (cb.checked) {
        addr.value = '';
        wrap.classList.add('ol-disabled');
        $('#ol-suggest').hidden = true;
      } else {
        wrap.classList.remove('ol-disabled');
      }
    });
  }

  // ---------- DaData address autocomplete ----------
  function bindAddressAutocomplete() {
    const input = $('#ol-address');
    const wrap = $('#ol-suggest');
    let timer = null;
    let lastItems = [];

    input.addEventListener('input', () => {
      clearTimeout(timer);
      timer = setTimeout(() => fetchSuggest(input.value), 300);
    });
    input.addEventListener('blur', () => setTimeout(() => { wrap.hidden = true; }, 150));
    input.addEventListener('focus', () => {
      if (lastItems.length && input.value.trim().length >= 3) wrap.hidden = false;
    });

    async function fetchSuggest(q) {
      q = (q || '').trim();
      if (q.length < 3) { wrap.hidden = true; return; }
      try {
        const r = await fetch('/api/v1/dadata/address?q=' + encodeURIComponent(q));
        if (!r.ok) { wrap.hidden = true; return; }
        const json = await r.json();
        const items = (json.suggestions || []).slice(0, 7);
        lastItems = items;
        if (!items.length) { wrap.hidden = true; return; }
        wrap.innerHTML = items.map((s, i) =>
          `<div class="dadata-item" data-i="${i}">${escapeHtml(s.value)}</div>`).join('');
        wrap.hidden = false;
        wrap.querySelectorAll('.dadata-item').forEach((it) => {
          it.addEventListener('mousedown', (e) => e.preventDefault()); // не терять фокус
          it.addEventListener('click', () => {
            const sug = items[Number(it.dataset.i)];
            input.value = sug.value;
            // Если в форме город ещё пустой — подставим из DaData
            const cityField = document.querySelector('input[name="city"]');
            if (cityField && !cityField.value.trim()) {
              const data = sug.data || {};
              cityField.value = data.city_with_type || data.settlement_with_type || data.region_with_type || '';
            }
            wrap.hidden = true;
          });
        });
      } catch (e) {
        console.warn('dadata address:', e);
        wrap.hidden = true;
      }
    }
  }

  // ---------- Календарь занятости ----------
  async function refreshCalendar(ymd) {
    const body = $('#ol-cal-body');
    const periodEl = $('#ol-cal-period');
    if (!body) return;

    if (state.calView === 'day') {
      if (periodEl) periodEl.textContent = formatDayHeader(ymd);
      body.innerHTML = '<div class="ol-cal-loading">Загрузка…</div>';
      await loadBusySlots(ymd);
      body.innerHTML = renderDayView();
      bindDayHourClicks();
    } else {
      if (periodEl) periodEl.textContent = formatWeekHeader(ymd);
      body.innerHTML = '<div class="ol-cal-loading">Загрузка…</div>';
      await loadBusyWeek(ymd);
      body.innerHTML = renderWeekView(ymd);
      bindWeekDayClicks();
    }
  }

  function formatWeekHeader(startYmd) {
    const start = parseYmd(startYmd);
    const end = new Date(start); end.setDate(end.getDate() + 6);
    const sameMonth = start.getMonth() === end.getMonth();
    return sameMonth
      ? `${start.getDate()}–${end.getDate()} ${MONTHS_SHORT[start.getMonth()]}.`
      : `${start.getDate()} ${MONTHS_SHORT[start.getMonth()]} – ${end.getDate()} ${MONTHS_SHORT[end.getMonth()]}.`;
  }

  // Слоты выбранного менеджера. Если менеджер не выбран — пустой массив
  // (UI покажет placeholder).
  function slotsOfSelectedFromList(slots) {
    const mgrId = selectedManagerId();
    if (!mgrId) return null; // null = «не выбран»
    return slots.filter((s) => s.manager_id === mgrId);
  }

  // Возвращает массив часов 9..18 (включительно), для каждого:
  // { hour, busy: bool, slot: ?{label, source, range} }.
  // Час считается занятым, если хотя бы 1 минута пересекается с busy_at..busy_at+duration.
  function buildHourGrid(slots) {
    const occupiedBy = new Map(); // hour → { label, range, source }
    for (const s of slots) {
      const start = new Date(s.meeting_at);
      const end = new Date(start.getTime() + (s.duration_minutes || 60) * 60_000);
      const range = `${pad2(start.getHours())}:${pad2(start.getMinutes())}–${pad2(end.getHours())}:${pad2(end.getMinutes())}`;
      const startH = start.getHours();
      const startM = start.getMinutes();
      const endH = end.getHours();
      const endM = end.getMinutes();
      // Пробегаемся по часам, на которые слот «накладывается».
      for (let h = HOUR_FROM; h < HOUR_TO; h++) {
        const hourStart = h * 60;
        const hourEnd = (h + 1) * 60;
        const slotStart = startH * 60 + startM;
        const slotEnd = endH * 60 + endM;
        if (slotEnd > hourStart && slotStart < hourEnd) {
          // Сохраняем только первое попадание — этого хватит для подписи.
          if (!occupiedBy.has(h)) {
            occupiedBy.set(h, { label: s.label, range, source: s.source });
          }
        }
      }
    }
    const grid = [];
    for (let h = HOUR_FROM; h < HOUR_TO; h++) {
      const slot = occupiedBy.get(h);
      grid.push({ hour: h, busy: !!slot, slot });
    }
    return grid;
  }

  function renderDayView() {
    const filtered = slotsOfSelectedFromList(state.busySlots);
    if (filtered === null) {
      return `
        <div class="ol-cal-placeholder">
          Выберите менеджера в форме слева — здесь появится его расписание на выбранный день.
        </div>`;
    }
    if (!state.managers.find((m) => m.id === selectedManagerId())) {
      return '<div class="ol-cal-placeholder">Выбранный менеджер удалён.</div>';
    }
    const grid = buildHourGrid(filtered);
    return `<div class="ol-hour-grid">
      ${grid.map((cell) => {
        const label = `${pad2(cell.hour)}:00`;
        if (cell.busy) {
          const sourceCls = cell.slot.source === 'block' ? ' ol-hour-block' : '';
          return `
            <div class="ol-hour ol-hour-busy${sourceCls}">
              <div class="ol-hour-time">${label}</div>
              <div class="ol-hour-info">
                <div class="ol-hour-range">${escapeHtml(cell.slot.range)}</div>
                ${cell.slot.label ? `<div class="ol-hour-label">${escapeHtml(cell.slot.label)}</div>` : ''}
              </div>
            </div>`;
        }
        return `
          <button type="button" class="ol-hour ol-hour-free" data-hour="${pad2(cell.hour)}:00">
            <div class="ol-hour-time">${label}</div>
            <div class="ol-hour-info">
              <span class="ol-hour-take">свободно — кликнуть</span>
            </div>
          </button>`;
      }).join('')}
    </div>`;
  }

  function bindDayHourClicks() {
    document.querySelectorAll('.ol-hour-free').forEach((btn) => {
      btn.addEventListener('click', () => {
        const t = btn.dataset.hour;
        const timeInput = document.querySelector('input[name="meeting_time"]');
        if (timeInput) {
          timeInput.value = t;
          timeInput.dispatchEvent(new Event('change', { bubbles: true }));
          timeInput.focus();
        }
      });
    });
  }

  function renderWeekView(startYmd) {
    const start = parseYmd(startYmd);
    const mgrId = selectedManagerId();
    const days = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date(start); d.setDate(d.getDate() + i);
      const ymd = ymdLocal(d);
      const dayWd = (d.getDay() + 6) % 7; // 0..6 от пн
      const wdShort = ['пн','вт','ср','чт','пт','сб','вс'][dayWd];
      const allSlots = state.busyWeek[ymd] || [];
      const slots = mgrId ? allSlots.filter((s) => s.manager_id === mgrId) : allSlots;
      const slotsHtml = slots.length
        ? slots
            .slice()
            .sort((a, b) => a.meeting_at.localeCompare(b.meeting_at))
            .map((s) => {
              const startD = new Date(s.meeting_at);
              const endD = new Date(startD.getTime() + (s.duration_minutes || 60) * 60_000);
              const range = `${pad2(startD.getHours())}:${pad2(startD.getMinutes())}–${pad2(endD.getHours())}:${pad2(endD.getMinutes())}`;
              const sourceCls = s.source === 'block' ? ' ol-week-block' : '';
              return `<div class="ol-week-slot${sourceCls}">
                <span class="ol-week-time">${escapeHtml(range)}</span>
                ${s.label ? `<span class="ol-week-label">${escapeHtml(s.label)}</span>` : ''}
              </div>`;
            }).join('')
        : '<div class="ol-week-empty">— свободен</div>';
      days.push(`
        <div class="ol-week-day" data-ymd="${ymd}">
          <div class="ol-week-day-head">
            <span class="ol-week-num">${d.getDate()}</span>
            <span class="ol-week-wd">${wdShort}</span>
          </div>
          <div class="ol-week-day-slots">${slotsHtml}</div>
        </div>`);
    }
    const placeholder = mgrId
      ? ''
      : '<div class="ol-cal-placeholder ol-cal-placeholder-thin">Менеджер не выбран — показаны занятости всех. Выберите менеджера, чтобы остался только он.</div>';
    return placeholder + `<div class="ol-week-grid">${days.join('')}</div>`;
  }

  function bindWeekDayClicks() {
    document.querySelectorAll('.ol-week-day').forEach((el) => {
      el.addEventListener('click', () => {
        const ymd = el.dataset.ymd;
        // Переключаемся в дневной режим до dispatch, чтобы change-handler
        // на дате уже видел новое state.calView.
        state.calView = 'day';
        document.querySelectorAll('.ol-cal-view-btn').forEach((b) => {
          b.classList.toggle('primary', b.dataset.cv === 'day');
        });
        const dateInput = document.querySelector('input[name="meeting_date"]');
        if (dateInput) {
          dateInput.value = ymd;
          dateInput.dispatchEvent(new Event('change', { bubbles: true }));
        }
      });
    });
  }

  function bindCalendarViews() {
    document.querySelectorAll('.ol-cal-view-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        if (state.calView === btn.dataset.cv) return;
        state.calView = btn.dataset.cv;
        document.querySelectorAll('.ol-cal-view-btn').forEach((b) => {
          b.classList.toggle('primary', b === btn);
        });
        const ymd = document.querySelector('input[name="meeting_date"]')?.value || ymdLocal(new Date());
        refreshCalendar(ymd);
      });
    });
  }

  function bindManagerSelectChange() {
    const sel = document.querySelector('select[name="manager_id"]');
    if (!sel) return;
    sel.addEventListener('change', () => {
      const ymd = document.querySelector('input[name="meeting_date"]')?.value || ymdLocal(new Date());
      refreshCalendar(ymd);
    });
  }

  // ---------- Сохранение ----------
  async function saveForm(form) {
    const submitBtn = $('#ol-submit');
    submitBtn.disabled = true;

    try {
      const { data: { user } } = await sb.auth.getUser();
      if (!user) {
        toast('Сессия истекла — войдите заново.');
        return;
      }

      const fd = new FormData(form);
      const isOnline = fd.get('is_online') === 'on';
      const dateRaw = (fd.get('meeting_date') || '').trim();
      const timeRaw = (fd.get('meeting_time') || '').trim();
      let meetingIso = null;
      if (dateRaw) {
        const t = timeRaw || '00:00';
        meetingIso = new Date(`${dateRaw}T${t}`).toISOString();
      }

      const trimOrNull = (k) => {
        const v = (fd.get(k) || '').trim();
        return v || null;
      };

      const payload = {
        company_name:    (fd.get('company_name') || '').trim(),
        city:            trimOrNull('city'),
        meeting_address: isOnline ? null : trimOrNull('meeting_address'),
        meeting_at:      meetingIso,
        phone:           trimOrNull('phone'),
        called_phone:    trimOrNull('called_phone'),
        website:         trimOrNull('website'),
        lpr_name:        trimOrNull('lpr_name'),
        has_loyalty:     fd.get('has_loyalty') === 'on',
        comment:         trimOrNull('comment'),
        manager_id:      fd.get('manager_id') || null,
        operator_id:     user.id,
        status:          'meeting_scheduled',
      };

      // Онлайн-встречу маркируем в комментарии (отдельной колонки is_online не делаем —
      // это редкий маркер, не стоит миграции).
      if (isOnline) {
        const tag = '🌐 Онлайн-встреча';
        payload.comment = payload.comment ? `${tag}\n\n${payload.comment}` : tag;
      }

      if (!payload.company_name) { toast('Укажите название компании.'); return; }
      if (!payload.manager_id) { toast('Выберите менеджера.'); return; }

      const { error } = await sb.from('leads').insert(payload);
      if (error) {
        console.error('insert lead:', error);
        toast('Не получилось сохранить: ' + (error.message || 'неизвестная ошибка'));
        return;
      }

      toast('Заявка передана менеджеру.');
      await loadData();
      renderList();
    } finally {
      if (submitBtn) submitBtn.disabled = false;
    }
  }

  async function refresh() {
    await loadData();
    if (state.view === 'create') renderCreate();
    else renderList();
  }

  window.operatorLeads = { show, refresh };
})();
