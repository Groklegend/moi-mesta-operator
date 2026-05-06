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
    editingLeadId: null,   // если != null — форма в режиме редактирования
    prefillLead: null,     // данные лида для предзаполнения формы
  };

  const HOUR_FROM = 8;     // рабочий день для почасовой сетки (МСК)
  const HOUR_TO = 20;
  const PINNED_KEY = 'mm_op_pinned_managers_v1';

  // ---------- Московское время ----------
  // Все времена в БД — UTC. На фронте показываем и интерпретируем как МСК (+03:00 без DST).
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
  function mskYmd(d) { const p = _mskParts(d); return `${p.y}-${pad2(p.mo)}-${pad2(p.d)}`; }
  // "YYYY-MM-DD" + "HH:MM" в МСК → UTC ISO
  function mskToUtcIso(ymd, hm) {
    return `${ymd}T${hm || '00:00'}:00+03:00`;
  }
  function mskNow() { return new Date(); } // объект «сейчас» — компоненты МСК через mskHM/mskYmd

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
    const p = _mskParts(new Date(iso));
    return `${p.d} ${MONTHS_SHORT[p.mo - 1]}, ${pad2(p.h)}:${pad2(p.mi)}`;
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
        .select('*')
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
    const ymd = document.querySelector('input[name="ol_md"]')?.value || mskYmd(new Date());
    refreshCalendar(ymd);
  }

  // ---------- Точка входа ----------
  // Любой переход на вкладку «Плюс Заявка» (клик в шапке, /hub→оператор и т.д.)
  // возвращает оператора в список заявок. Вход в форму — только через
  // «＋ Новая заявка» или клик по карточке существующего лида.
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
    state.view = 'list';
    state.editingLeadId = null;
    state.prefillLead = null;
    renderList();
  }

  // ---------- Список заявок ----------
  function renderList() {
    state.view = 'list';
    const pane = $('#leads-plus-pane');
    pane.innerHTML = `
      <div class="ol-wrap">
        <div class="ol-header">
          <div>
            <h2 class="ol-title">Плюс Заявка</h2>
            <p class="ol-sub">Карточки клиентов после холодного звонка. Кликните по существующей, чтобы отредактировать.</p>
          </div>
          <button class="btn primary ol-add" type="button" id="ol-add-btn">＋ Новая заявка</button>
        </div>
        <div class="ol-list">${renderListItems()}</div>
      </div>`;
    $('#ol-add-btn').addEventListener('click', () => {
      state.editingLeadId = null;
      state.prefillLead = null;
      state.view = 'create';
      renderCreate();
    });
    pane.querySelectorAll('.ol-card[data-id]').forEach((card) => {
      card.addEventListener('click', () => enterEditMode(card.dataset.id));
    });
  }

  function renderListItems() {
    if (!state.leads.length) {
      return '<div class="ol-empty">Заявок пока нет. Нажмите «＋ Новая заявка», чтобы создать первую.</div>';
    }
    return state.leads.map((lead) => {
      const editedAt = leadEditedAt(lead);
      const editedHtml = editedAt
        ? `<div class="ol-card-edited">Отредактировано ${escapeHtml(formatEditedShort(editedAt))}</div>`
        : '';
      return `
      <button type="button" class="ol-card" data-id="${escapeHtml(lead.id)}">
        <div class="ol-card-main">
          <div class="ol-card-title">${escapeHtml(lead.company_name)}</div>
          <div class="ol-card-meta">
            <span class="ol-card-city">${escapeHtml(lead.city || '— город не указан')}</span>
            <span class="ol-card-meet">${escapeHtml(formatMeetingShort(lead.meeting_at))}</span>
          </div>
          ${editedHtml}
        </div>
        <div class="ol-card-mgr">
          <span class="ol-card-mgr-label">Менеджер:</span>
          <span class="ol-card-mgr-name">${escapeHtml(getManagerName(lead.manager_id))}</span>
        </div>
      </button>`;
    }).join('');
  }

  // Считаем лид «отредактированным», если updated_at заметно (>5 сек) больше
  // created_at. Авто-trigger ставит updated_at при любом INSERT, так что без
  // буфера каждая «новая» заявка тоже выглядит как «отредактированная».
  function leadEditedAt(lead) {
    if (!lead.updated_at || !lead.created_at) return null;
    const u = new Date(lead.updated_at).getTime();
    const c = new Date(lead.created_at).getTime();
    return (u - c) > 5000 ? lead.updated_at : null;
  }
  function formatEditedShort(iso) {
    const p = _mskParts(new Date(iso));
    return `${p.d} ${MONTHS_SHORT[p.mo - 1]} в ${pad2(p.h)}:${pad2(p.mi)}`;
  }

  function enterEditMode(leadId) {
    const lead = state.leads.find((l) => l.id === leadId);
    if (!lead) return;
    state.editingLeadId = leadId;
    state.prefillLead = lead;
    state.view = 'create';
    // Активный менеджер = тот, кому уже передан лид. Если он удалён —
    // оставим без активного, чтобы оператор мог выбрать заново.
    state.activeMgrId = state.managers.find((m) => m.id === lead.manager_id)
      ? lead.manager_id : '';
    renderCreate();
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

    const isEditing = !!state.prefillLead;
    const initialYmd = isEditing && state.prefillLead.meeting_at
      ? mskYmd(new Date(state.prefillLead.meeting_at))
      : mskYmd(new Date());
    const titleText = isEditing ? 'Редактирование заявки' : 'Новая заявка';

    pane.innerHTML = `
      <div class="ol-wrap ol-create">
        <div class="ol-toolbar">
          <div class="ol-mgr-tabs" id="ol-mgr-tabs"></div>
          <div class="ol-toolbar-right">
            <span class="ol-cal-period" id="ol-cal-period">${escapeHtml(formatDayHeader(initialYmd))}</span>
            <div class="ol-cal-views">
              <button type="button" class="ol-cal-view-btn primary" data-cv="day">День</button>
              <button type="button" class="ol-cal-view-btn" data-cv="week">Неделя</button>
            </div>
          </div>
        </div>
        <div class="ol-create-grid">
          <div class="ol-create-col-left">
            <div class="ol-create-head">
              <button class="ol-back-btn" type="button" id="ol-back">← К списку</button>
              <h2 class="ol-title">${escapeHtml(titleText)}</h2>
            </div>
            <div class="ol-form" id="ol-form" autocomplete="off">
              <div class="ol-grid">
                <label class="ol-field ol-field-wide">
                  <span class="ol-label">Название компании <em>*</em></span>
                  <input type="text" name="ol_cn" maxlength="120"
                         autocomplete="off" data-lpignore="true" data-1p-ignore="true" data-form-type="other">
                </label>

                <label class="ol-field ol-field-wide ol-field-checkbox">
                  <input type="checkbox" name="ol_online" id="ol-is-online">
                  <span>Онлайн-встреча (без адреса)</span>
                </label>

                <div class="ol-field ol-field-wide ol-address-wrap">
                  <span class="ol-label" id="ol-address-label">Адрес встречи</span>
                  <input type="text" name="ol_addr" id="ol-address" maxlength="240" placeholder="Город, улица, дом, офис…"
                         autocomplete="off" data-lpignore="true" data-1p-ignore="true" data-form-type="other">
                  <div class="dadata-suggest ol-suggest" id="ol-suggest" hidden></div>
                </div>

                <label class="ol-field ol-field-wide">
                  <span class="ol-label">Уточнение по встрече</span>
                  <input type="text" name="ol_addr_note" maxlength="240" placeholder="Пример: встреча в кафе"
                         autocomplete="off" data-lpignore="true" data-1p-ignore="true" data-form-type="other">
                </label>

                <div class="ol-field">
                  <span class="ol-label">Дата встречи <em>*</em></span>
                  <div class="ol-date-control">
                    <button type="button" class="ol-date-arrow" data-shift="-1" aria-label="Предыдущий день">‹</button>
                    <input type="date" name="ol_md" id="ol-meeting-date" value="${initialYmd}"
                           autocomplete="off" data-lpignore="true" data-1p-ignore="true" data-form-type="other">
                    <button type="button" class="ol-date-arrow" data-shift="1" aria-label="Следующий день">›</button>
                  </div>
                </div>

                <label class="ol-field">
                  <span class="ol-label">Время встречи <em>*</em></span>
                  <input type="time" name="ol_mt"
                         autocomplete="off" data-lpignore="true" data-1p-ignore="true" data-form-type="other">
                </label>

                <div class="ol-field ol-field-wide">
                  <span class="ol-label">Лицо, принимающее решение?</span>
                  <div class="ol-radio">
                    <label><input type="radio" name="ol_lpr" value="yes" checked> Да</label>
                    <label><input type="radio" name="ol_lpr" value="no"> Нет</label>
                  </div>
                </div>

                <div class="ol-phones-row ol-field-wide">
                  <label class="ol-field">
                    <span class="ol-label" id="ol-phone-label">Телефон ЛПР <em>*</em></span>
                    <input type="text" name="ol_p1" maxlength="22"
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
                    <input type="text" name="ol_p2" maxlength="22"
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
                  <input type="text" name="ol_pname" maxlength="80" placeholder="Иван Иванов"
                         autocomplete="off" data-lpignore="true" data-1p-ignore="true" data-form-type="other">
                </label>

                <label class="ol-field ol-field-wide">
                  <span class="ol-label">Должность</span>
                  <input type="text" name="ol_ppos" maxlength="80" placeholder="Директор"
                         autocomplete="off" data-lpignore="true" data-1p-ignore="true" data-form-type="other">
                </label>

                <label class="ol-field ol-field-wide">
                  <span class="ol-label">Сайт</span>
                  <input type="text" name="ol_site" maxlength="200" placeholder="https://..."
                         autocomplete="off" data-lpignore="true" data-1p-ignore="true" data-form-type="other">
                </label>

                <label class="ol-field ol-field-wide">
                  <span class="ol-label">Telegram-канал</span>
                  <input type="text" name="ol_tg" maxlength="80" placeholder="@channel"
                         autocomplete="off" data-lpignore="true" data-1p-ignore="true" data-form-type="other">
                </label>

                <div class="ol-field ol-field-wide">
                  <span class="ol-label">Программа лояльности?</span>
                  <div class="ol-radio">
                    <label><input type="radio" name="ol_loy" value="yes"> Да</label>
                    <label><input type="radio" name="ol_loy" value="no"> Нет</label>
                  </div>
                </div>

                <div class="ol-field ol-field-wide" id="ol-loy-yes" hidden>
                  <span class="ol-label">Тип программы</span>
                  <div class="ol-radio">
                    <label><input type="radio" name="ol_loy_kind" value="discount"> Скидка</label>
                    <label><input type="radio" name="ol_loy_kind" value="bonus"> Бонус</label>
                  </div>
                </div>

                <div class="ol-field ol-field-wide" id="ol-loy-no" hidden>
                  <span class="ol-label">Была ли программа лояльности ранее?</span>
                  <div class="ol-radio">
                    <label><input type="radio" name="ol_loy_before" value="yes"> Да</label>
                    <label><input type="radio" name="ol_loy_before" value="no"> Нет</label>
                  </div>
                </div>

                <div class="ol-field ol-field-wide" id="ol-loy-before-yes" hidden>
                  <span class="ol-label">Какая была программа?</span>
                  <div class="ol-radio">
                    <label><input type="radio" name="ol_loy_before_kind" value="discount"> Скидка</label>
                    <label><input type="radio" name="ol_loy_before_kind" value="bonus"> Бонус</label>
                  </div>
                </div>
              </div>

              <div class="ol-actions">
                <button type="button" class="btn" id="ol-cancel">Отмена</button>
                <button type="button" class="btn primary" id="ol-submit">${isEditing ? 'Сохранить изменения' : 'Сохранить и передать менеджеру'}</button>
              </div>
            </div>
          </div>

          <aside class="ol-create-col-right">
            <div class="ol-cal-body" id="ol-cal-body">
              <div class="ol-cal-loading">Загрузка…</div>
            </div>
          </aside>
        </div>
      </div>`;

    const exitToList = () => {
      state.editingLeadId = null;
      state.prefillLead = null;
      renderList();
    };
    $('#ol-back').addEventListener('click', exitToList);
    $('#ol-cancel').addEventListener('click', exitToList);
    $('#ol-submit').addEventListener('click', () => saveForm());
    bindLprRadio();
    bindLoyaltyRadio();

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

    // Если режим редактирования — заполняем форму данными существующего лида.
    if (isEditing) prefillForm(state.prefillLead);

    // Календарь на нужную дату (для нового лида — сегодня, для edit — день встречи).
    await refreshCalendar(initialYmd);

    if (!isEditing) $('input[name="ol_cn"]')?.focus();
  }

  // Заполняет форму значениями лида при входе в режим редактирования.
  // Обратное преобразование к saveForm: разбираем lpr_name на имя+должность,
  // is_online выводим из meeting_address=null, теги в comment — флаги (НЕ ЛПР,
  // онлайн), loyalty_description — обратно в каскад радио.
  function prefillForm(lead) {
    const root = $('#ol-form');
    if (!root) return;
    const setVal = (name, val) => {
      const el = root.querySelector(`[name="${name}"]`);
      if (el) el.value = val == null ? '' : String(val);
    };
    const setRadio = (name, val) => {
      const el = root.querySelector(`input[name="${name}"][value="${val}"]`);
      if (el) el.checked = true;
    };
    const fire = (name) => {
      root.querySelector(`input[name="${name}"]:checked`)?.dispatchEvent(new Event('change', { bubbles: true }));
    };

    setVal('ol_cn', lead.company_name);

    const isOnline = !lead.meeting_address && !!lead.city;
    if (isOnline) {
      const cb = root.querySelector('[name="ol_online"]');
      if (cb) { cb.checked = true; cb.dispatchEvent(new Event('change', { bubbles: true })); }
      setVal('ol_addr', lead.city || '');
    } else {
      setVal('ol_addr', lead.meeting_address || '');
      state.dadataCity = lead.city || '';
    }
    setVal('ol_addr_note', lead.meeting_address_note);

    if (lead.meeting_at) {
      const p = _mskParts(new Date(lead.meeting_at));
      setVal('ol_md', `${p.y}-${pad2(p.mo)}-${pad2(p.d)}`);
      setVal('ol_mt', `${pad2(p.h)}:${pad2(p.mi)}`);
    }

    // Тег «НЕ ЛПР» в comment → is_lpr=no.
    const isNotLpr = (lead.comment || '').includes('⚠️ Контакт — НЕ ЛПР');
    setRadio('ol_lpr', isNotLpr ? 'no' : 'yes');
    fire('ol_lpr');

    setVal('ol_p1', lead.phone);
    setVal('ol_p2', lead.called_phone);
    // Применяем маску к уже заполненным телефонам.
    ['ol_p1', 'ol_p2'].forEach((n) => {
      const el = root.querySelector(`[name="${n}"]`);
      if (el && el.value) el.dispatchEvent(new Event('input', { bubbles: true }));
    });

    // lpr_name = "Имя, Должность" → разбираем по запятой.
    const parts = (lead.lpr_name || '').split(',');
    setVal('ol_pname', (parts[0] || '').trim());
    setVal('ol_ppos', (parts.slice(1).join(',') || '').trim());

    setVal('ol_site', lead.website);
    setVal('ol_tg', lead.telegram);

    // Обратное соответствие к loyalty_description. Порядок важен: сначала
    // выбираем корневой ответ и фаерим change, чтобы bindLoyaltyRadio
    // показал нужный подблок и почистил скрытые поля. Только потом ставим
    // значения во вложенных подвопросах.
    const desc = lead.loyalty_description || '';
    if (lead.has_loyalty === true) {
      setRadio('ol_loy', 'yes');
      fire('ol_loy');
      if (desc === 'Скидка') setRadio('ol_loy_kind', 'discount');
      else if (desc === 'Бонус') setRadio('ol_loy_kind', 'bonus');
    } else if (lead.has_loyalty === false && desc) {
      setRadio('ol_loy', 'no');
      fire('ol_loy');
      if (desc === 'Ранее была: скидка') {
        setRadio('ol_loy_before', 'yes');
        fire('ol_loy_before');
        setRadio('ol_loy_before_kind', 'discount');
      } else if (desc === 'Ранее была: бонус') {
        setRadio('ol_loy_before', 'yes');
        fire('ol_loy_before');
        setRadio('ol_loy_before_kind', 'bonus');
      } else if (desc === 'Ранее была') {
        setRadio('ol_loy_before', 'yes');
        fire('ol_loy_before');
      } else if (desc === 'Ранее не было') {
        setRadio('ol_loy_before', 'no');
        fire('ol_loy_before');
      }
    }
  }

  function bindPhoneMasks() {
    document.querySelectorAll('input[name="ol_p1"], input[name="ol_p2"]').forEach(bindPhoneMask);
    $('#ol-phone-copy')?.addEventListener('click', () => {
      const src = document.querySelector('input[name="ol_p1"]');
      const dst = document.querySelector('input[name="ol_p2"]');
      if (!src || !dst) return;
      dst.value = src.value;
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

  // Возвращает массив сегментов: каждый сегмент — либо free (1 шаг),
  // либо busy с указанным `span` (число шагов, которые накрывает одно
  // событие). Несколько подряд идущих шагов, попадающих в одно событие,
  // схлопываются в одну плашку — чтобы встреча 12:23–14:00 не дублировалась
  // в строках 12:00 и 13:00.
  function buildStepGrid(slots) {
    const stepM = stepFromActiveManager();
    const events = slots
      .map((s) => {
        const start = new Date(s.meeting_at);
        const end = new Date(start.getTime() + (s.duration_minutes || 60) * 60_000);
        const sH = mskHM(start), eH = mskHM(end);
        return {
          startM: sH.h * 60 + sH.m,
          endM: eH.h * 60 + eH.m,
          range: `${pad2(sH.h)}:${pad2(sH.m)}–${pad2(eH.h)}:${pad2(eH.m)}`,
          label: s.label,
          source: s.source,
        };
      })
      .sort((a, b) => a.startM - b.startM);

    const segments = [];
    let m = HOUR_FROM * 60;
    while (m < HOUR_TO * 60) {
      const ev = events.find((e) => e.endM > m && e.startM < m + stepM);
      const label = `${pad2(Math.floor(m / 60))}:${pad2(m % 60)}`;
      if (ev) {
        let next = m;
        while (next < HOUR_TO * 60 && ev.endM > next && ev.startM < next + stepM) {
          next += stepM;
        }
        segments.push({
          busy: true,
          span: (next - m) / stepM,
          label,
          slot: { label: ev.label, range: ev.range, source: ev.source },
        });
        m = next;
      } else {
        segments.push({ busy: false, span: 1, label });
        m += stepM;
      }
    }
    return segments;
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
    const segments = buildStepGrid(filtered);
    return `<div class="ol-hour-grid">
      ${segments.map((seg) => {
        if (seg.busy) {
          const sourceCls = seg.slot.source === 'block' ? ' ol-hour-block' : '';
          const spanAttr = seg.span > 1 ? ` style="--ol-span:${seg.span};"` : '';
          return `
            <div class="ol-hour ol-hour-busy${sourceCls}"${spanAttr}>
              <div class="ol-hour-time">${seg.label}</div>
              <div class="ol-hour-info">
                <div class="ol-hour-range">${escapeHtml(seg.slot.range)}</div>
                ${seg.slot.label ? `<div class="ol-hour-label">${escapeHtml(seg.slot.label)}</div>` : ''}
              </div>
            </div>`;
        }
        return `
          <button type="button" class="ol-hour ol-hour-free" data-time="${seg.label}">
            <div class="ol-hour-time">${seg.label}</div>
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
        const timeInput = document.querySelector('input[name="ol_mt"]');
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
              const sH = mskHM(startD), eH = mskHM(endD);
              const range = `${pad2(sH.h)}:${pad2(sH.m)}–${pad2(eH.h)}:${pad2(eH.m)}`;
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
        const dateInput = document.querySelector('input[name="ol_md"]');
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
        const ymd = document.querySelector('input[name="ol_md"]')?.value || mskYmd(new Date());
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
    if (state.activeMgrId === id) {
      state.activeMgrId = state.pinnedMgrIds[0] || '';
      const ymd = document.querySelector('input[name="ol_md"]')?.value || mskYmd(new Date());
      renderMgrTabs();
      refreshCalendar(ymd);
    } else {
      renderMgrTabs();
    }
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
    const checkedVal = (name) => root.querySelector(`input[name="${name}"]:checked`)?.value || '';
    return {
      company_name: get('ol_cn').trim(),
      is_online: !!root.querySelector('[name="ol_online"]:checked'),
      meeting_address: get('ol_addr').trim(),
      addr_note: get('ol_addr_note').trim(),
      meeting_date: get('ol_md').trim(),
      meeting_time: get('ol_mt').trim(),
      is_lpr: checkedVal('ol_lpr') === 'no' ? 'no' : 'yes',
      phone: get('ol_p1').trim(),
      called_phone: get('ol_p2').trim(),
      lpr_name: get('ol_pname').trim(),
      lpr_position: get('ol_ppos').trim(),
      website: get('ol_site').trim(),
      telegram: get('ol_tg').trim(),
      // Программа лояльности — каскад вопросов:
      //  loy = ''       — оператор не уточнил
      //  loy = 'yes'    — есть, тип в loy_kind ('discount' | 'bonus')
      //  loy = 'no'     — нет; ранее? в loy_before ('yes' | 'no')
      //                   если loy_before='yes' → какая была? loy_before_kind
      loy: checkedVal('ol_loy'),
      loy_kind: checkedVal('ol_loy_kind'),
      loy_before: checkedVal('ol_loy_before'),
      loy_before_kind: checkedVal('ol_loy_before_kind'),
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
      const phoneDigits = (s) => String(s || '').replace(/\D/g, '').length;
      if (!f.company_name) { toast('Укажите название компании.'); return; }
      if (!state.activeMgrId) { toast('Закрепите менеджера наверху правой панели (＋).'); return; }
      if (!f.meeting_date) { toast('Укажите дату встречи.'); return; }
      if (!f.meeting_time) { toast('Укажите время встречи.'); return; }
      if (!f.phone) { toast(f.is_lpr === 'yes' ? 'Укажите телефон ЛПР.' : 'Укажите телефон.'); return; }
      if (phoneDigits(f.phone) !== 11) {
        toast(f.is_lpr === 'yes' ? 'Телефон ЛПР введён не полностью.' : 'Телефон введён не полностью.');
        return;
      }
      if (!f.called_phone) { toast('Укажите номер, на который звонили.'); return; }
      if (phoneDigits(f.called_phone) !== 11) { toast('Номер, на который звонили, введён не полностью.'); return; }

      // Дата/время в форме интерпретируются как МСК (+03:00).
      const meetingIso = new Date(mskToUtcIso(f.meeting_date, f.meeting_time)).toISOString();

      // City: при онлайне — то, что оператор написал в поле «Город встречи»;
      // иначе — из DaData при выборе подсказки.
      const city = f.is_online ? (f.meeting_address || null) : (state.dadataCity || null);
      const meetingAddress = f.is_online ? null : (f.meeting_address || null);

      // Имя + должность объединяем в lpr_name через запятую.
      let lprName = '';
      if (f.lpr_name && f.lpr_position) lprName = `${f.lpr_name}, ${f.lpr_position}`;
      else lprName = f.lpr_name || f.lpr_position || '';

      // Поле «Комментарий» в форме скрыто. Авто-теги (НЕ ЛПР / Онлайн)
      // оператор по-прежнему пишет в comment, чтобы менеджер их видел.
      let comment = '';
      if (f.is_lpr === 'no') comment = '⚠️ Контакт — НЕ ЛПР';
      if (f.is_online) comment = comment ? `🌐 Онлайн-встреча\n\n${comment}` : '🌐 Онлайн-встреча';

      // Программа лояльности → has_loyalty + текстовое описание.
      let hasLoyalty = false;
      let loyaltyDescription = null;
      if (f.loy === 'yes') {
        hasLoyalty = true;
        if (f.loy_kind === 'discount') loyaltyDescription = 'Скидка';
        else if (f.loy_kind === 'bonus') loyaltyDescription = 'Бонус';
      } else if (f.loy === 'no') {
        hasLoyalty = false;
        if (f.loy_before === 'yes') {
          if (f.loy_before_kind === 'discount') loyaltyDescription = 'Ранее была: скидка';
          else if (f.loy_before_kind === 'bonus') loyaltyDescription = 'Ранее была: бонус';
          else loyaltyDescription = 'Ранее была';
        } else if (f.loy_before === 'no') {
          loyaltyDescription = 'Ранее не было';
        }
      }

      const payload = {
        company_name:         f.company_name,
        city,
        meeting_address:      meetingAddress,
        meeting_address_note: f.addr_note || null,
        meeting_at:           meetingIso,
        phone:                f.phone || null,
        called_phone:         f.called_phone || null,
        website:              f.website || null,
        telegram:             f.telegram || null,
        lpr_name:             lprName || null,
        has_loyalty:          hasLoyalty,
        loyalty_description:  loyaltyDescription,
        comment:              comment || null,
        manager_id:           state.activeMgrId,
      };

      if (state.editingLeadId) {
        // UPDATE — operator_id/status/created_at не трогаем; updated_at
        // ставится автоматически триггером leads_updated_at_trg.
        const { error } = await sb.from('leads').update(payload).eq('id', state.editingLeadId);
        if (error) {
          console.error('update lead:', error);
          toast('Не получилось сохранить: ' + (error.message || 'неизвестная ошибка'));
          return;
        }
        toast('Изменения сохранены.');
      } else {
        const insertPayload = { ...payload, operator_id: user.id, status: 'meeting_scheduled' };
        const { error } = await sb.from('leads').insert(insertPayload);
        if (error) {
          console.error('insert lead:', error);
          toast('Не получилось сохранить: ' + (error.message || 'неизвестная ошибка'));
          return;
        }
        toast('Заявка передана менеджеру.');
      }

      state.editingLeadId = null;
      state.prefillLead = null;
      await loadData();
      renderList();
    } finally {
      if (submitBtn) submitBtn.disabled = false;
    }
  }

  function bindLprRadio() {
    document.querySelectorAll('input[name="ol_lpr"]').forEach((r) => {
      r.addEventListener('change', () => {
        const isLpr = document.querySelector('input[name="ol_lpr"]:checked')?.value === 'yes';
        const phoneLabel = $('#ol-phone-label');
        if (phoneLabel) phoneLabel.innerHTML = isLpr ? 'Телефон ЛПР <em>*</em>' : 'Телефон <em>*</em>';
      });
    });
  }

  // «Программа лояльности? → Да/Нет». При «Да» — Тип (Скидка/Бонус) и
  // вопрос «была ли ранее» прячется. При «Нет» — «была ли ранее»; если на
  // него ответили «Да», ниже спрашиваем «Какая была программа?» (Скидка/Бонус).
  // Скрытые подветки очищаются, чтобы readForm не подхватил мусор.
  function bindLoyaltyRadio() {
    const yesBlock = document.getElementById('ol-loy-yes');
    const noBlock = document.getElementById('ol-loy-no');
    const beforeYesBlock = document.getElementById('ol-loy-before-yes');
    const clearChecked = (name) => document
      .querySelectorAll(`input[name="${name}"]`)
      .forEach((x) => { x.checked = false; });

    document.querySelectorAll('input[name="ol_loy"]').forEach((r) => {
      r.addEventListener('change', () => {
        const v = document.querySelector('input[name="ol_loy"]:checked')?.value;
        if (yesBlock) yesBlock.hidden = v !== 'yes';
        if (noBlock) noBlock.hidden = v !== 'no';
        if (beforeYesBlock) beforeYesBlock.hidden = true;
        if (v === 'yes') {
          clearChecked('ol_loy_before');
          clearChecked('ol_loy_before_kind');
        } else if (v === 'no') {
          clearChecked('ol_loy_kind');
          clearChecked('ol_loy_before_kind');
        }
      });
    });

    document.querySelectorAll('input[name="ol_loy_before"]').forEach((r) => {
      r.addEventListener('change', () => {
        const v = document.querySelector('input[name="ol_loy_before"]:checked')?.value;
        if (beforeYesBlock) beforeYesBlock.hidden = v !== 'yes';
        if (v !== 'yes') clearChecked('ol_loy_before_kind');
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
