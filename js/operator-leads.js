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
    pinnedMgrIds: [],      // закреплённые менеджеры (localStorage)
    activeMgrId: '',       // активный менеджер (выбранный таб)
    dadataCity: '',        // город, прилетевший из DaData при выборе адреса
  };

  const HOUR_FROM = 9;     // рабочий день для почасовой сетки
  const HOUR_TO = 19;
  const PINNED_KEY = 'mm_op_pinned_managers_v1';

  function loadPinned() {
    try {
      const raw = localStorage.getItem(PINNED_KEY);
      const arr = JSON.parse(raw || '[]');
      return Array.isArray(arr) ? arr : [];
    } catch { return []; }
  }
  function savePinned(ids) {
    try { localStorage.setItem(PINNED_KEY, JSON.stringify(ids)); } catch (_) {}
  }

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
        .select('id, full_name, email, status, cal_step_minutes')
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

  // Активный менеджер — выбранный таб над расписанием.
  function selectedManagerId() {
    return state.activeMgrId || '';
  }

  function setActiveMgr(id) {
    state.activeMgrId = id || '';
    renderMgrTabs();
    const ymd = document.querySelector('input[name="meeting_date"]')?.value || ymdLocal(new Date());
    refreshCalendar(ymd);
  }

  // ---------- Точка входа ----------
  async function show() {
    const pane = $('#leads-plus-pane');
    if (!pane) return;
    if (!state.initialized) {
      pane.innerHTML = '<div class="ol-loading">Загрузка…</div>';
      state.pinnedMgrIds = loadPinned();
      await loadData();
      // Чистим pinned от удалённых менеджеров
      state.pinnedMgrIds = state.pinnedMgrIds.filter((id) =>
        state.managers.some((m) => m.id === id)
      );
      savePinned(state.pinnedMgrIds);
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
    state.dadataCity = ''; // свежая форма — кэш города сброшен
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
            <div class="ol-form" id="ol-form" autocomplete="off">
              <div class="ol-grid">
                <label class="ol-field ol-field-wide">
                  <span class="ol-label">Название компании <em>*</em></span>
                  <input type="text" name="company_name" maxlength="120">
                </label>

                <label class="ol-field ol-field-wide ol-field-checkbox">
                  <input type="checkbox" name="is_online" id="ol-is-online">
                  <span>Онлайн-встреча (без адреса)</span>
                </label>

                <div class="ol-field ol-field-wide ol-address-wrap">
                  <span class="ol-label" id="ol-address-label">Адрес встречи</span>
                  <input type="text" name="meeting_address" id="ol-address" maxlength="240" placeholder="Город, улица, дом, офис…">
                  <div class="dadata-suggest ol-suggest" id="ol-suggest" hidden></div>
                </div>

                <div class="ol-field">
                  <span class="ol-label">Дата встречи <em>*</em></span>
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

                <div class="ol-field ol-field-wide">
                  <span class="ol-label">Лицо, принимающее решение?</span>
                  <div class="ol-radio">
                    <label><input type="radio" name="is_lpr" value="yes" checked> Да</label>
                    <label><input type="radio" name="is_lpr" value="no"> Нет</label>
                  </div>
                </div>

                <div class="ol-phones-row ol-field-wide">
                  <label class="ol-field">
                    <span class="ol-label" id="ol-phone-label">Телефон ЛПР <em>*</em></span>
                    <input type="text" name="phone" maxlength="22"
                           placeholder="8 (962) 323-25-47"
                           inputmode="tel"
                           autocomplete="off"
                           data-lpignore="true"
                           data-1p-ignore="true"
                           data-form-type="other">
                  </label>
                  <button type="button" class="ol-phone-copy" id="ol-phone-copy"
                          aria-label="Скопировать в «Номер, на который звонили»"
                          title="Скопировать в «Номер, на который звонили»">→</button>
                  <label class="ol-field">
                    <span class="ol-label">Номер, на который звонили <em>*</em></span>
                    <input type="text" name="called_phone" maxlength="22"
                           placeholder="8 (962) 323-25-47"
                           inputmode="tel"
                           autocomplete="off"
                           data-lpignore="true"
                           data-1p-ignore="true"
                           data-form-type="other">
                  </label>
                </div>

                <label class="ol-field ol-field-wide">
                  <span class="ol-label">Имя</span>
                  <input type="text" name="lpr_name" maxlength="80" placeholder="Иван Иванов">
                </label>

                <label class="ol-field ol-field-wide">
                  <span class="ol-label">Должность</span>
                  <input type="text" name="lpr_position" maxlength="80" placeholder="Директор">
                </label>

                <label class="ol-field ol-field-wide">
                  <span class="ol-label">Сайт</span>
                  <input type="text" name="website" maxlength="200" placeholder="https://...">
                </label>

                <label class="ol-field ol-field-wide ol-field-checkbox">
                  <input type="checkbox" name="has_loyalty">
                  <span>Есть программа лояльности</span>
                </label>

                <label class="ol-field ol-field-wide">
                  <span class="ol-label">Комментарий</span>
                  <textarea name="comment" rows="3" maxlength="2000" placeholder="Что обсудили, особенности клиента, договорённости…"></textarea>
                </label>
              </div>

              <div class="ol-actions">
                <button type="button" class="btn" id="ol-cancel">Отмена</button>
                <button type="button" class="btn primary" id="ol-submit">Сохранить и передать менеджеру</button>
              </div>
            </div>
          </div>

          <aside class="ol-create-col-right">
            <div class="ol-cal-head">
              <div class="ol-mgr-tabs" id="ol-mgr-tabs"></div>
              <div class="ol-cal-head-right">
                <span class="ol-cal-period" id="ol-cal-period">${escapeHtml(formatDayHeader(todayYmd))}</span>
                <div class="ol-cal-views">
                  <button type="button" class="ol-cal-view-btn primary" data-cv="day">День</button>
                  <button type="button" class="ol-cal-view-btn" data-cv="week">Неделя</button>
                </div>
              </div>
            </div>
            <div class="ol-cal-body" id="ol-cal-body">
              <div class="ol-cal-loading">Загрузка…</div>
            </div>
          </aside>
        </div>
      </div>`;

    $('#ol-back').addEventListener('click', () => renderList());
    $('#ol-cancel').addEventListener('click', () => renderList());
    $('#ol-submit').addEventListener('click', () => saveForm());
    bindLprRadio();

    bindDateControl();
    bindOnlineCheckbox();
    bindAddressAutocomplete();
    bindCalendarViews();
    bindPhoneMasks();

    // Если есть закреплённые менеджеры — активируем первого автоматически.
    if (!state.activeMgrId && state.pinnedMgrIds.length) {
      state.activeMgrId = state.pinnedMgrIds[0];
    }
    renderMgrTabs();

    // Календарь на сегодня
    await refreshCalendar(todayYmd);

    $('input[name="company_name"]')?.focus();
  }

  function bindPhoneMasks() {
    document.querySelectorAll('input[name="phone"], input[name="called_phone"]').forEach(bindPhoneMask);
    $('#ol-phone-copy')?.addEventListener('click', () => {
      const src = document.querySelector('input[name="phone"]');
      const dst = document.querySelector('input[name="called_phone"]');
      if (!src || !dst) return;
      dst.value = src.value;
      // Триггерим input, чтобы маска применилась повторно (на всякий случай).
      dst.dispatchEvent(new Event('input', { bubbles: true }));
    });
  }

  function bindPhoneMask(input) {
    input.addEventListener('input', () => {
      input.value = formatPhoneRu(input.value);
    });
  }

  // Формат «8 (962) 323-25-47». Принимаем любую вводимую цифровую строку,
  // 7 в начале меняем на 8, дополняем 8 если её нет, режем до 11 цифр.
  function formatPhoneRu(raw) {
    let d = String(raw).replace(/\D/g, '');
    if (d.startsWith('7')) d = '8' + d.slice(1);
    if (d && !d.startsWith('8')) d = '8' + d;
    d = d.slice(0, 11);
    if (!d) return '';
    let out = d[0];
    if (d.length > 1) out += ' (' + d.slice(1, Math.min(4, d.length));
    if (d.length === 4) out += ')';
    if (d.length > 4) out += ') ' + d.slice(4, Math.min(7, d.length));
    if (d.length > 7) out += '-' + d.slice(7, Math.min(9, d.length));
    if (d.length > 9) out += '-' + d.slice(9, 11);
    return out;
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
    const label = $('#ol-address-label');
    cb.addEventListener('change', () => {
      // При онлайне поле «Адрес» превращается в «Город встречи»:
      // оператор просто пишет город, а адрес сохраняется как null.
      addr.value = '';
      state.dadataCity = '';
      $('#ol-suggest').hidden = true;
      if (cb.checked) {
        if (label) label.textContent = 'Город встречи';
        addr.placeholder = 'Например: Омск';
      } else {
        if (label) label.textContent = 'Адрес встречи';
        addr.placeholder = 'Город, улица, дом, офис…';
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
      // Ручной ввод — кэшированный из DaData город больше не валиден.
      state.dadataCity = '';
      clearTimeout(timer);
      timer = setTimeout(() => fetchSuggest(input.value), 300);
    });
    input.addEventListener('blur', () => setTimeout(() => { wrap.hidden = true; }, 150));
    input.addEventListener('focus', () => {
      if (lastItems.length && input.value.trim().length >= 3) wrap.hidden = false;
    });

    async function fetchSuggest(q) {
      // При онлайне поле — это «Город встречи», подсказки не нужны.
      if ($('#ol-is-online')?.checked) { wrap.hidden = true; return; }
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
            const data = sug.data || {};
            // Город из выбранного адреса — сохраняем в state, в БД попадёт
            // отдельной колонкой city при сохранении формы.
            state.dadataCity = data.city_with_type || data.settlement_with_type || data.region_with_type || '';
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

  // Возвращает массив ячеек по выбранному шагу (60/90/120 минут).
  // Ячейка считается занятой, если хотя бы 1 минута пересекается с
  // событием [busy_at, busy_at+duration_minutes).
  function buildStepGrid(slots) {
    const stepM = stepFromActiveManager();
    const occupiedBy = new Map(); // start_minute → { label, range, source }
    for (const s of slots) {
      const start = new Date(s.meeting_at);
      const end = new Date(start.getTime() + (s.duration_minutes || 60) * 60_000);
      const range = `${pad2(start.getHours())}:${pad2(start.getMinutes())}–${pad2(end.getHours())}:${pad2(end.getMinutes())}`;
      const slotStart = start.getHours() * 60 + start.getMinutes();
      const slotEnd = end.getHours() * 60 + end.getMinutes();
      for (let m = HOUR_FROM * 60; m < HOUR_TO * 60; m += stepM) {
        if (slotEnd > m && slotStart < m + stepM) {
          if (!occupiedBy.has(m)) {
            occupiedBy.set(m, { label: s.label, range, source: s.source });
          }
        }
      }
    }
    const grid = [];
    for (let m = HOUR_FROM * 60; m < HOUR_TO * 60; m += stepM) {
      const slot = occupiedBy.get(m);
      grid.push({ minutes: m, label: `${pad2(Math.floor(m / 60))}:${pad2(m % 60)}`, busy: !!slot, slot });
    }
    return grid;
  }

  function renderDayView() {
    const filtered = slotsOfSelectedFromList(state.busySlots);
    if (filtered === null) {
      return `
        <div class="ol-cal-placeholder">
          Закрепите менеджера через <b>＋</b> выше или выберите его в форме слева — здесь появится его расписание.
        </div>`;
    }
    if (!state.managers.find((m) => m.id === selectedManagerId())) {
      return '<div class="ol-cal-placeholder">Выбранный менеджер удалён.</div>';
    }
    const grid = buildStepGrid(filtered);
    return `<div class="ol-hour-grid">
      ${grid.map((cell) => {
        if (cell.busy) {
          const sourceCls = cell.slot.source === 'block' ? ' ol-hour-block' : '';
          return `
            <div class="ol-hour ol-hour-busy${sourceCls}">
              <div class="ol-hour-time">${cell.label}</div>
              <div class="ol-hour-info">
                <div class="ol-hour-range">${escapeHtml(cell.slot.range)}</div>
                ${cell.slot.label ? `<div class="ol-hour-label">${escapeHtml(cell.slot.label)}</div>` : ''}
              </div>
            </div>`;
        }
        return `
          <button type="button" class="ol-hour ol-hour-free" data-time="${cell.label}">
            <div class="ol-hour-time">${cell.label}</div>
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
        const t = btn.dataset.time;
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

  // Шаг сетки — собственное поле менеджера. Оператор только читает.
  function stepFromActiveManager() {
    const m = state.managers.find((x) => x.id === state.activeMgrId);
    const v = m?.cal_step_minutes;
    return [60, 90].includes(v) ? v : 60;
  }

  // ---------- Закреплённые менеджеры (tabs над календарём) ----------
  function renderMgrTabs() {
    const wrap = $('#ol-mgr-tabs');
    if (!wrap) return;
    const activeId = selectedManagerId();
    // Перечень tabs: pinned ∪ {активный, если он не в pinned}.
    const ids = [...state.pinnedMgrIds];
    if (activeId && !ids.includes(activeId)) ids.push(activeId);

    const tabsHtml = ids.map((id) => {
      const m = state.managers.find((x) => x.id === id);
      if (!m) return '';
      const name = (m.full_name || '').trim() || m.email;
      const isActive = id === activeId;
      const isPinned = state.pinnedMgrIds.includes(id);
      return `
        <button type="button" class="ol-mgr-tab${isActive ? ' active' : ''}" data-mgr-id="${id}">
          <span class="ol-mgr-tab-name">${escapeHtml(name)}</span>
          ${isPinned ? `<span class="ol-mgr-tab-close" data-close-id="${id}" title="Убрать">×</span>` : ''}
        </button>`;
    }).filter(Boolean).join('');

    wrap.innerHTML = tabsHtml + `<button type="button" class="ol-mgr-add" id="ol-mgr-add" title="Закрепить менеджера">＋</button>`;

    wrap.querySelectorAll('.ol-mgr-tab').forEach((t) => {
      t.addEventListener('click', (e) => {
        if (e.target.classList.contains('ol-mgr-tab-close')) return;
        const id = t.dataset.mgrId;
        if (id !== state.activeMgrId) setActiveMgr(id);
      });
    });
    wrap.querySelectorAll('.ol-mgr-tab-close').forEach((c) => {
      c.addEventListener('click', (e) => {
        e.stopPropagation();
        removePinned(c.dataset.closeId);
      });
    });
    $('#ol-mgr-add')?.addEventListener('click', (e) => {
      e.stopPropagation();
      openMgrPicker();
    });
  }

  function addPinned(id) {
    if (!state.pinnedMgrIds.includes(id)) {
      state.pinnedMgrIds.push(id);
      savePinned(state.pinnedMgrIds);
    }
  }

  function removePinned(id) {
    state.pinnedMgrIds = state.pinnedMgrIds.filter((x) => x !== id);
    savePinned(state.pinnedMgrIds);
    renderMgrTabs();
    // Если активным был удалённый — оставим в форме, чтобы не терять контекст
    // (он будет показан как «непрепный» tab без крестика). Если хотим сбросить —
    // делается ручным кликом на другого менеджера.
  }

  function openMgrPicker() {
    // Закрываем существующий picker, если был.
    const existing = document.querySelector('.ol-mgr-picker');
    if (existing) { existing.remove(); return; }

    const activeId = selectedManagerId();
    const taken = new Set([...state.pinnedMgrIds, activeId].filter(Boolean));
    const candidates = state.managers.filter((m) => !taken.has(m.id));
    if (!candidates.length) {
      toast('Все менеджеры уже в списке.');
      return;
    }
    const btn = $('#ol-mgr-add');
    if (!btn) return;
    const rect = btn.getBoundingClientRect();
    const popup = document.createElement('div');
    popup.className = 'ol-mgr-picker';
    popup.style.left = rect.left + 'px';
    popup.style.top = (rect.bottom + window.scrollY + 6) + 'px';
    popup.innerHTML = candidates.map((m) => `
      <button type="button" class="ol-mgr-picker-item" data-id="${m.id}">
        ${escapeHtml((m.full_name || '').trim() || m.email)}
      </button>
    `).join('');
    document.body.appendChild(popup);

    popup.querySelectorAll('.ol-mgr-picker-item').forEach((it) => {
      it.addEventListener('click', () => {
        const id = it.dataset.id;
        addPinned(id);
        setActiveMgr(id);
        popup.remove();
        document.removeEventListener('click', closePicker);
      });
    });

    function closePicker(e) {
      if (popup.contains(e.target) || e.target.closest('#ol-mgr-add')) return;
      popup.remove();
      document.removeEventListener('click', closePicker);
    }
    setTimeout(() => document.addEventListener('click', closePicker), 0);
  }

  // ---------- Сохранение ----------
  function readForm() {
    const root = $('#ol-form');
    const get = (name) => root.querySelector(`[name="${name}"]`)?.value || '';
    const checked = (name) => !!root.querySelector(`[name="${name}"]:checked`);
    return {
      company_name: get('company_name').trim(),
      is_online: !!root.querySelector('[name="is_online"]:checked'),
      meeting_address: get('meeting_address').trim(),
      meeting_date: get('meeting_date').trim(),
      meeting_time: get('meeting_time').trim(),
      is_lpr: (root.querySelector('input[name="is_lpr"]:checked')?.value) === 'no' ? 'no' : 'yes',
      phone: get('phone').trim(),
      called_phone: get('called_phone').trim(),
      lpr_name: get('lpr_name').trim(),
      lpr_position: get('lpr_position').trim(),
      website: get('website').trim(),
      has_loyalty: !!root.querySelector('[name="has_loyalty"]:checked'),
      comment: get('comment').trim(),
    };
  }

  async function saveForm() {
    const submitBtn = $('#ol-submit');
    submitBtn.disabled = true;

    try {
      const { data: { user } } = await sb.auth.getUser();
      if (!user) {
        toast('Сессия истекла — войдите заново.');
        return;
      }

      const f = readForm();

      // Валидация обязательных полей
      if (!f.company_name) { toast('Укажите название компании.'); return; }
      if (!state.activeMgrId) { toast('Закрепите менеджера наверху правой панели (＋).'); return; }
      if (!f.meeting_date) { toast('Укажите дату встречи.'); return; }
      if (!f.phone) { toast(f.is_lpr === 'yes' ? 'Укажите телефон ЛПР.' : 'Укажите телефон.'); return; }
      if (!f.called_phone) { toast('Укажите номер, на который звонили.'); return; }

      // Время необязательно: если указано — берём; иначе 00:00.
      const t = f.meeting_time || '00:00';
      const meetingIso = new Date(`${f.meeting_date}T${t}`).toISOString();

      // City: при онлайне — то, что оператор написал в поле «Город встречи»;
      // иначе — из DaData при выборе подсказки.
      const city = f.is_online ? (f.meeting_address || null) : (state.dadataCity || null);
      const meetingAddress = f.is_online ? null : (f.meeting_address || null);

      // Имя + должность объединяем в lpr_name через запятую.
      let lprName = '';
      if (f.lpr_name && f.lpr_position) lprName = `${f.lpr_name}, ${f.lpr_position}`;
      else lprName = f.lpr_name || f.lpr_position || '';

      // Маркер «не ЛПР» — добавляем в комментарий, чтобы менеджер видел.
      let comment = f.comment || '';
      if (f.is_lpr === 'no') {
        const tag = '⚠️ Контакт — НЕ ЛПР';
        comment = comment ? `${tag}\n\n${comment}` : tag;
      }
      if (f.is_online) {
        const tag = '🌐 Онлайн-встреча';
        comment = comment ? `${tag}\n\n${comment}` : tag;
      }

      const payload = {
        company_name:    f.company_name,
        city,
        meeting_address: meetingAddress,
        meeting_at:      meetingIso,
        phone:           f.phone || null,
        called_phone:    f.called_phone || null,
        website:         f.website || null,
        lpr_name:        lprName || null,
        has_loyalty:     f.has_loyalty,
        comment:         comment || null,
        manager_id:      state.activeMgrId,
        operator_id:     user.id,
        status:          'meeting_scheduled',
      };

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

  function bindLprRadio() {
    document.querySelectorAll('input[name="is_lpr"]').forEach((r) => {
      r.addEventListener('change', () => {
        const isLpr = document.querySelector('input[name="is_lpr"]:checked')?.value === 'yes';
        const phoneLabel = $('#ol-phone-label');
        if (phoneLabel) phoneLabel.innerHTML = isLpr ? 'Телефон ЛПР <em>*</em>' : 'Телефон <em>*</em>';
      });
    });
  }

  async function refresh() {
    await loadData();
    if (state.view === 'create') renderCreate();
    else renderList();
  }

  window.operatorLeads = { show, refresh };
})();
