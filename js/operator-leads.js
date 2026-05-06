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
    busySlots: [],         // [{manager_id, meeting_at}] на выбранный день
  };

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
            <h3 class="ol-cal-title">Расписание менеджеров</h3>
            <div class="ol-cal-day" id="ol-cal-day">${escapeHtml(formatDayHeader(todayYmd))}</div>
            <div class="ol-cal-list" id="ol-cal-list">
              <div class="ol-cal-loading">Загрузка…</div>
            </div>
            <p class="ol-cal-hint">Если менеджер свободен в нужный слот — выбирайте его в форме слева.</p>
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
    const list = $('#ol-cal-list');
    const dayEl = $('#ol-cal-day');
    if (!list) return;
    if (dayEl) dayEl.textContent = formatDayHeader(ymd);
    list.innerHTML = '<div class="ol-cal-loading">Загрузка…</div>';
    await loadBusySlots(ymd);
    list.innerHTML = renderCalendarItems();
  }

  function renderCalendarItems() {
    if (!state.managers.length) {
      return '<div class="ol-cal-empty">Активных менеджеров нет.</div>';
    }
    // Группируем занятые слоты по manager_id (с длительностью).
    const byMgr = new Map();
    for (const s of state.busySlots) {
      const arr = byMgr.get(s.manager_id) || [];
      arr.push({ at: s.meeting_at, duration: s.duration_minutes || 60 });
      byMgr.set(s.manager_id, arr);
    }
    return state.managers.map((m) => {
      const slots = (byMgr.get(m.id) || [])
        .sort((a, b) => a.at.localeCompare(b.at))
        .map(({ at, duration }) => {
          const start = new Date(at);
          const end = new Date(start.getTime() + duration * 60_000);
          return `${pad2(start.getHours())}:${pad2(start.getMinutes())}–${pad2(end.getHours())}:${pad2(end.getMinutes())}`;
        });
      const name = (m.full_name || '').trim() || m.email;
      const slotsHtml = slots.length
        ? slots.map((t) => `<span class="ol-cal-busy">${escapeHtml(t)}</span>`).join('')
        : '<span class="ol-cal-free-tag">свободен весь день</span>';
      return `
        <div class="ol-cal-mgr${slots.length ? '' : ' ol-cal-mgr-free'}">
          <div class="ol-cal-mgr-name">${escapeHtml(name)}</div>
          <div class="ol-cal-mgr-slots">${slotsHtml}</div>
        </div>`;
    }).join('');
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
