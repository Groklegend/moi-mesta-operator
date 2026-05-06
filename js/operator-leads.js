// Раздел «Заявка Плюс» в кабинете оператора.
// Оператор создаёт лид (карточку клиента), привязывает менеджера,
// заявка появляется в seller.html → «Мои лиды» у выбранного менеджера.
// Поля pitch/recommendations/operator_call наполнит позже Гари — здесь
// заполняются только базовые контактные и встречные данные.

(function () {
  'use strict';

  const $ = (sel, el = document) => el.querySelector(sel);

  const state = {
    leads: [],
    managers: [],
    initialized: false,
  };

  // ---------- Утилиты ----------
  function escapeHtml(s) {
    return String(s ?? '').replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
  }

  const MONTHS_SHORT = ['янв','фев','мар','апр','мая','июн','июл','авг','сен','окт','ноя','дек'];
  function pad2(n) { return String(n).padStart(2, '0'); }
  function formatMeetingShort(iso) {
    if (!iso) return '— дата не указана';
    const d = new Date(iso);
    return `${d.getDate()} ${MONTHS_SHORT[d.getMonth()]}, ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
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
    // Активные менеджеры — на выбор в форме
    state.managers = (mgrsRes.data || []).filter((u) => u.status !== 'disabled');
  }

  // ---------- Рендер списка ----------
  function renderList() {
    const pane = $('#leads-plus-pane');
    if (!pane) return;
    pane.innerHTML = `
      <div class="ol-wrap">
        <div class="ol-header">
          <div>
            <h2 class="ol-title">Заявка Плюс</h2>
            <p class="ol-sub">Карточки клиентов после холодного звонка. Передаются менеджеру и попадают в его раздел «Мои лиды».</p>
          </div>
          <button class="btn primary ol-add" type="button" id="ol-add-btn">＋ Новая заявка</button>
        </div>
        <div class="ol-list" id="ol-list">${renderListItems()}</div>
      </div>`;
    $('#ol-add-btn').addEventListener('click', openCreateForm);
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
      </div>
    `).join('');
  }

  // ---------- Форма создания ----------
  function openCreateForm() {
    if (!state.managers.length) {
      toast('Нет активных менеджеров. Попросите коммерческого добавить хотя бы одного.');
      return;
    }

    const backdrop = document.createElement('div');
    backdrop.className = 'modal-backdrop ol-modal';
    backdrop.style.zIndex = '9999';
    backdrop.innerHTML = `
      <div class="modal-window ol-form-window" role="dialog" aria-modal="true">
        <h3 class="modal-title">Новая заявка</h3>
        <form class="ol-form" id="ol-form" autocomplete="off">
          <div class="ol-grid">
            <label class="ol-field ol-field-wide">
              <span class="ol-label">Название компании <em>*</em></span>
              <input type="text" name="company_name" required maxlength="120">
            </label>

            <label class="ol-field">
              <span class="ol-label">Город</span>
              <input type="text" name="city" maxlength="80">
            </label>

            <label class="ol-field ol-field-wide">
              <span class="ol-label">Адрес встречи</span>
              <input type="text" name="meeting_address" maxlength="240" placeholder="Город, улица, дом, офис…">
            </label>

            <div class="ol-field">
              <span class="ol-label">Дата встречи</span>
              <div class="ol-date-control">
                <button type="button" class="ol-date-arrow" data-shift="-1" aria-label="Предыдущий день">‹</button>
                <input type="date" name="meeting_date">
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
              <span class="ol-label">Номер, с которого звонил</span>
              <input type="text" name="caller_phone" maxlength="40">
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
            <button type="button" class="btn" data-act="cancel">Отмена</button>
            <button type="submit" class="btn primary" id="ol-submit">Сохранить и передать менеджеру</button>
          </div>
        </form>
      </div>`;
    document.body.appendChild(backdrop);

    backdrop.addEventListener('click', (e) => {
      if (e.target === backdrop || e.target.dataset?.act === 'cancel') backdrop.remove();
    });
    backdrop.querySelector('#ol-form').addEventListener('submit', (e) => {
      e.preventDefault();
      saveForm(e.target, backdrop);
    });

    // Дата по умолчанию — сегодня (локальная), время оставляем пустым
    // (оператор вписывает сам). Стрелки сдвигают дату на ±1 день, без лимита.
    const dateInput = backdrop.querySelector('input[name="meeting_date"]');
    dateInput.value = ymdLocal(new Date());
    backdrop.querySelectorAll('.ol-date-arrow').forEach((btn) => {
      btn.addEventListener('click', () => {
        const days = parseInt(btn.dataset.shift, 10) || 0;
        const cur = dateInput.value ? parseYmd(dateInput.value) : new Date();
        cur.setDate(cur.getDate() + days);
        dateInput.value = ymdLocal(cur);
      });
    });

    // Фокус на первом поле
    backdrop.querySelector('input[name="company_name"]')?.focus();
  }

  function ymdLocal(d) {
    return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
  }
  function parseYmd(s) {
    // 'YYYY-MM-DD' → локальная дата 00:00 (без UTC-сдвига).
    const [y, m, dd] = s.split('-').map(Number);
    return new Date(y, m - 1, dd);
  }

  async function saveForm(form, modalEl) {
    const submitBtn = modalEl.querySelector('#ol-submit');
    submitBtn.disabled = true;

    try {
      const { data: { user } } = await sb.auth.getUser();
      if (!user) {
        toast('Сессия истекла — войдите заново.');
        return;
      }

      const fd = new FormData(form);
      // Дата + время собираются из двух отдельных полей. Если время не
      // указано — берём 00:00 (полночь). Если даты нет — meeting_at = null
      // и в карточке у менеджера встреча будет «не назначена».
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
        meeting_address: trimOrNull('meeting_address'),
        meeting_at:      meetingIso,
        phone:           trimOrNull('phone'),
        caller_phone:    trimOrNull('caller_phone'),
        website:         trimOrNull('website'),
        lpr_name:        trimOrNull('lpr_name'),
        has_loyalty:     fd.get('has_loyalty') === 'on',
        comment:         trimOrNull('comment'),
        manager_id:      fd.get('manager_id') || null,
        operator_id:     user.id,
        status:          'meeting_scheduled',
      };

      if (!payload.company_name) {
        toast('Укажите название компании.');
        return;
      }
      if (!payload.manager_id) {
        toast('Выберите менеджера.');
        return;
      }

      const { error } = await sb.from('leads').insert(payload);
      if (error) {
        console.error('insert lead:', error);
        toast('Не получилось сохранить: ' + (error.message || 'неизвестная ошибка'));
        return;
      }

      modalEl.remove();
      toast('Заявка передана менеджеру.');
      await loadData();
      renderList();
    } finally {
      if (submitBtn) submitBtn.disabled = false;
    }
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
    renderList();
  }

  async function refresh() {
    await loadData();
    renderList();
  }

  window.operatorLeads = { show, refresh };
})();
