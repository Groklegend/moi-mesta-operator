// ============================================================
// commercial.js — кабинет коммерческого директора
// ============================================================
// Три раздела:
//   1. Операторы (CRUD таблицы operators) — раньше жил в админке.
//   2. Статистика операторов — рендерится скриптом stats.js, который
//      подключается отдельно: он находит #op-filter, .stats-filters
//      и сам всё нарисует.
//   3. Статистика менеджеров — сводка по seller_daily_reports.

(function () {
  if (!document.getElementById('section-operators')) return;

  // ---------- Утилиты ----------
  function $(s, r = document) { return r.querySelector(s); }
  function $$(s, r = document) { return Array.from(r.querySelectorAll(s)); }

  function toast(msg, kind) {
    const t = document.getElementById('toast');
    if (!t) return;
    t.textContent = msg;
    t.classList.remove('hidden');
    t.style.background = kind === 'error' ? 'var(--danger)' : '';
    clearTimeout(toast._t);
    toast._t = setTimeout(() => t.classList.add('hidden'), 1800);
  }

  // ---------- Универсальная модалка (свой openModal/closeModal) ----------
  const modal = document.getElementById('modal');
  const modalTitle = document.getElementById('modal-title');
  const modalBody = document.getElementById('modal-body');
  document.getElementById('modal-close')?.addEventListener('click', closeModal);
  let _modalDownOnBackdrop = false;
  modal?.addEventListener('mousedown', e => { _modalDownOnBackdrop = (e.target.id === 'modal'); });
  modal?.addEventListener('click', e => {
    if (e.target.id === 'modal' && _modalDownOnBackdrop) closeModal();
    _modalDownOnBackdrop = false;
  });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') closeModal(); });

  function openModal(title, html) {
    if (!modal) return;
    modalTitle.textContent = title;
    modalBody.innerHTML = html;
    modal.classList.remove('hidden');
  }
  function closeModal() { modal?.classList.add('hidden'); }

  function fmtDate(iso) {
    if (!iso) return '—';
    return new Date(iso).toLocaleDateString('ru-RU', { day:'numeric', month:'short', year:'numeric' });
  }

  // ============================================================
  // ОПЕРАТОРЫ (перенесено из admin.js, минимально адаптировано)
  // ============================================================

  let opsCache = [];

  function renderPasswordCell(pw) {
    if (!pw) return '<span class="muted" style="font-size:12px;">— не задан —</span>';
    const safe = escapeHtml(pw);
    return `
      <span class="pw-cell">
        <code class="pw-value" data-pw="${safe}" data-shown="0">••••••••</code>
        <button class="btn sm pw-toggle" type="button" title="Показать/скрыть">👁</button>
        <button class="btn sm pw-copy" type="button" data-pw="${safe}" title="Скопировать">📋</button>
      </span>`;
  }

  async function loadOperators() {
    const tbody = $('#op-table tbody');
    if (!tbody) return;
    tbody.innerHTML = `<tr><td colspan="6" class="empty">Загрузка…</td></tr>`;
    const { data, error } = await sb.from('operators')
      .select('id, name, login, password, is_active, created_at')
      .order('created_at', { ascending: false });
    if (error) {
      tbody.innerHTML = `<tr><td colspan="6" class="empty">Ошибка: ${escapeHtml(error.message)}</td></tr>`;
      return;
    }
    opsCache = data || [];
    if (!opsCache.length) {
      tbody.innerHTML = `<tr><td colspan="6" class="empty">Операторов пока нет. Нажмите «+ Добавить оператора».</td></tr>`;
      return;
    }
    tbody.innerHTML = opsCache.map(op => `
      <tr>
        <td><strong>${escapeHtml(op.name)}</strong></td>
        <td><code style="font-size:13px;">${escapeHtml(op.login)}</code></td>
        <td>${renderPasswordCell(op.password)}</td>
        <td>${op.is_active
          ? '<span class="badge" style="background:var(--success-soft);color:var(--success);">Активен</span>'
          : '<span class="badge muted">Отключён</span>'}</td>
        <td style="color:var(--muted);font-size:13px;">${fmtDate(op.created_at)}</td>
        <td class="actions-cell">
          <button class="btn sm" data-edit="${op.id}">Ред.</button>
          <button class="btn sm danger" data-del="${op.id}">Удалить</button>
        </td>
      </tr>`).join('');
    tbody.querySelectorAll('[data-edit]').forEach(b => b.addEventListener('click', () => editOp(b.dataset.edit)));
    tbody.querySelectorAll('[data-del]').forEach(b => b.addEventListener('click', () => deleteOp(b.dataset.del)));
    tbody.querySelectorAll('.pw-toggle').forEach(b => b.addEventListener('click', (e) => {
      const cell = e.currentTarget.parentElement.querySelector('.pw-value');
      const shown = cell.dataset.shown === '1';
      cell.textContent = shown ? '••••••••' : cell.dataset.pw;
      cell.dataset.shown = shown ? '0' : '1';
    }));
    tbody.querySelectorAll('.pw-copy').forEach(b => b.addEventListener('click', async (e) => {
      try { await navigator.clipboard.writeText(e.currentTarget.dataset.pw); toast('Пароль скопирован'); }
      catch { toast('Не удалось скопировать', 'error'); }
    }));
  }

  $('#op-add')?.addEventListener('click', () => editOp(null));

  function editOp(id) {
    const op = id ? opsCache.find(x => x.id === id) : { name:'', login:'', password:'', is_active: true };
    const isNew = !id;
    openModal(isNew ? 'Новый оператор' : 'Редактировать оператора', `
      <form class="form-grid" id="op-form">
        <label><div class="lbl">Имя</div>
          <input type="text" name="name" value="${escapeHtml(op.name)}" required placeholder="Иван Петров"></label>
        <label><div class="lbl">Логин</div>
          <input type="text" name="login" value="${escapeHtml(op.login)}" required
                 autocomplete="off" pattern="[A-Za-z0-9_.\\-]{3,32}"
                 title="Латиница, цифры, _ . - (3–32 символа)"
                 placeholder="ivan.petrov">
        </label>
        <label><div class="lbl">Пароль</div>
          <input type="text" name="password" value="${escapeHtml(op.password || '')}" ${isNew ? 'required' : ''}
                 autocomplete="new-password" minlength="6" placeholder="Минимум 6 символов"></label>
        ${isNew ? '' : `
        <label style="display:flex;align-items:center;gap:8px;">
          <input type="checkbox" name="is_active" ${op.is_active ? 'checked' : ''}>
          <span>Активен (может заходить на сайт)</span>
        </label>`}
        <div class="row">
          <button type="submit" class="btn primary">Сохранить</button>
          <button type="button" class="btn" id="cancel">Отмена</button>
        </div>
      </form>`);
    document.getElementById('cancel').addEventListener('click', closeModal);
    document.getElementById('op-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const name = String(fd.get('name')).trim();
      const login = String(fd.get('login')).trim().toLowerCase();
      const password = String(fd.get('password') || '');
      const payload = { name, login };
      if (!isNew) payload.is_active = fd.has('is_active');
      if (password) {
        if (password.length < 6) { toast('Пароль минимум 6 символов', 'error'); return; }
        payload.password = password;
      } else if (isNew) {
        toast('Задайте пароль', 'error'); return;
      }
      const btn = e.submitter;
      btn.disabled = true; btn.textContent = 'Сохраняем…';
      const { data: saved, error } = isNew
        ? await sb.from('operators').insert(payload).select().maybeSingle()
        : await sb.from('operators').update(payload).eq('id', id).select().maybeSingle();
      btn.disabled = false; btn.textContent = 'Сохранить';
      if (error) {
        const msg = error.message.includes('operators_login_key') || error.code === '23505'
          ? 'Логин уже занят — выберите другой'
          : 'Ошибка: ' + error.message;
        toast(msg, 'error'); return;
      }
      if (window.audit) audit.save('operators', isNew, saved?.id || id, {
        name: payload.name, login: payload.login,
        is_active: payload.is_active, password_changed: !!payload.password,
      });
      closeModal(); toast('Сохранено'); loadOperators();
    });
  }

  async function deleteOp(id) {
    const op = opsCache.find(x => x.id === id);
    if (!op) return;
    const ok = await confirmDialog({
      title: 'Удалить оператора?',
      message: `«${op.name}» будет удалён. Действие необратимо.`,
      okText: 'Удалить', cancelText: 'Отмена', danger: true,
    });
    if (!ok) return;
    const { error } = await sb.from('operators').delete().eq('id', id);
    if (error) { toast('Ошибка: ' + error.message, 'error'); return; }
    if (window.audit) audit.del('operators', id, op.name);
    toast('Удалено'); loadOperators();
  }

  // ============================================================
  // МЕНЕДЖЕРЫ (sellers) — зеркало операторов
  // ============================================================

  let sellersCache = [];

  async function loadSellers() {
    const tbody = $('#seller-table tbody');
    if (!tbody) return;
    tbody.innerHTML = `<tr><td colspan="6" class="empty">Загрузка…</td></tr>`;
    const { data, error } = await sb.from('sellers')
      .select('id, name, login, password, is_active, created_at')
      .order('created_at', { ascending: false });
    if (error) {
      tbody.innerHTML = `<tr><td colspan="6" class="empty">Ошибка: ${escapeHtml(error.message)}</td></tr>`;
      return;
    }
    sellersCache = data || [];
    if (!sellersCache.length) {
      tbody.innerHTML = `<tr><td colspan="6" class="empty">Менеджеров пока нет. Нажмите «+ Добавить менеджера».</td></tr>`;
      return;
    }
    tbody.innerHTML = sellersCache.map(s => `
      <tr>
        <td><strong>${escapeHtml(s.name)}</strong></td>
        <td><code style="font-size:13px;">${escapeHtml(s.login)}</code></td>
        <td>${renderPasswordCell(s.password)}</td>
        <td>${s.is_active
          ? '<span class="badge" style="background:var(--success-soft);color:var(--success);">Активен</span>'
          : '<span class="badge muted">Отключён</span>'}</td>
        <td style="color:var(--muted);font-size:13px;">${fmtDate(s.created_at)}</td>
        <td class="actions-cell">
          <button class="btn sm" data-edit-seller="${s.id}">Ред.</button>
          <button class="btn sm danger" data-del-seller="${s.id}">Удалить</button>
        </td>
      </tr>`).join('');
    tbody.querySelectorAll('[data-edit-seller]').forEach(b => b.addEventListener('click', () => editSeller(b.dataset.editSeller)));
    tbody.querySelectorAll('[data-del-seller]').forEach(b => b.addEventListener('click', () => deleteSeller(b.dataset.delSeller)));
    tbody.querySelectorAll('.pw-toggle').forEach(b => b.addEventListener('click', (e) => {
      const cell = e.currentTarget.parentElement.querySelector('.pw-value');
      const shown = cell.dataset.shown === '1';
      cell.textContent = shown ? '••••••••' : cell.dataset.pw;
      cell.dataset.shown = shown ? '0' : '1';
    }));
    tbody.querySelectorAll('.pw-copy').forEach(b => b.addEventListener('click', async (e) => {
      try { await navigator.clipboard.writeText(e.currentTarget.dataset.pw); toast('Пароль скопирован'); }
      catch { toast('Не удалось скопировать', 'error'); }
    }));
  }

  $('#seller-add')?.addEventListener('click', () => editSeller(null));

  function editSeller(id) {
    const s = id ? sellersCache.find(x => x.id === id) : { name:'', login:'', password:'', is_active: true };
    const isNew = !id;
    openModal(isNew ? 'Новый менеджер' : 'Редактировать менеджера', `
      <form class="form-grid" id="seller-form">
        <label><div class="lbl">Имя</div>
          <input type="text" name="name" value="${escapeHtml(s.name)}" required placeholder="Иван Петров"></label>
        <label><div class="lbl">Логин (почта)</div>
          <input type="email" name="login" value="${escapeHtml(s.login)}" required
                 autocomplete="off"
                 title="Введите email менеджера"
                 placeholder="ivan.petrov@example.com">
        </label>
        <label><div class="lbl">Пароль</div>
          <input type="text" name="password" value="${escapeHtml(s.password || '')}" ${isNew ? 'required' : ''}
                 autocomplete="new-password" minlength="6" placeholder="Минимум 6 символов"></label>
        ${isNew ? '' : `
        <label style="display:flex;align-items:center;gap:8px;">
          <input type="checkbox" name="is_active" ${s.is_active ? 'checked' : ''}>
          <span>Активен (может заходить на сайт)</span>
        </label>`}
        <div class="row">
          <button type="submit" class="btn primary">Сохранить</button>
          <button type="button" class="btn" id="cancel">Отмена</button>
        </div>
      </form>`);
    document.getElementById('cancel').addEventListener('click', closeModal);
    document.getElementById('seller-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const name = String(fd.get('name')).trim();
      const login = String(fd.get('login')).trim().toLowerCase();
      const password = String(fd.get('password') || '');
      const payload = { name, login };
      if (!isNew) payload.is_active = fd.has('is_active');
      if (password) {
        if (password.length < 6) { toast('Пароль минимум 6 символов', 'error'); return; }
        payload.password = password;
      } else if (isNew) {
        toast('Задайте пароль', 'error'); return;
      }
      const btn = e.submitter;
      btn.disabled = true; btn.textContent = 'Сохраняем…';
      const { data: saved, error } = isNew
        ? await sb.from('sellers').insert(payload).select().maybeSingle()
        : await sb.from('sellers').update(payload).eq('id', id).select().maybeSingle();
      btn.disabled = false; btn.textContent = 'Сохранить';
      if (error) {
        const msg = error.message.includes('sellers_login_key') || error.code === '23505'
          ? 'Логин уже занят — выберите другой'
          : 'Ошибка: ' + error.message;
        toast(msg, 'error'); return;
      }
      if (window.audit) audit.save('sellers', isNew, saved?.id || id, {
        name: payload.name, login: payload.login,
        is_active: payload.is_active, password_changed: !!payload.password,
      });
      closeModal(); toast('Сохранено'); loadSellers();
    });
  }

  async function deleteSeller(id) {
    const s = sellersCache.find(x => x.id === id);
    if (!s) return;
    const ok = await confirmDialog({
      title: 'Удалить менеджера?',
      message: `«${s.name}» будет удалён. Действие необратимо.`,
      okText: 'Удалить', cancelText: 'Отмена', danger: true,
    });
    if (!ok) return;
    const { error } = await sb.from('sellers').delete().eq('id', id);
    if (error) { toast('Ошибка: ' + error.message, 'error'); return; }
    if (window.audit) audit.del('sellers', id, s.name);
    toast('Удалено'); loadSellers();
  }

  // ============================================================
  // СТАТИСТИКА ПРОДАЖНИКОВ
  // ============================================================
  // Сводка по seller_daily_reports: KPI-карточки + таблица по менеджерам.
  // Период выбирается select'ом (неделя/месяц/квартал) и навигационными
  // стрелками. По умолчанию — текущий месяц.

  const SS_FIELDS = [
    { key: 'meetings_scheduled', label: 'Встречи назначены',   color: '#1E3A5F' },
    { key: 'meetings_held',      label: 'Встречи прошли',      color: '#2D3E52' },
    { key: 'agreed_to_test',     label: 'Согласились на тест', color: '#E8823D' },
    { key: 'refused',            label: 'Отказались',          color: '#C25450' },
    { key: 'thinking',           label: 'Подумают',            color: '#A0A9B5' },
    { key: 'integration_needed', label: 'Интеграция',          color: '#6B7A8A' },
    { key: 'launched_on_test',   label: 'Запущены на тест',    color: '#5A8A6E' },
    { key: 'signed_and_paid',    label: 'Договор + оплата',    color: '#166534' },
  ];

  const ssState = {
    range: 'month',
    anchor: new Date(), // точка отсчёта периода
  };

  function periodBounds(range, anchor) {
    const d = new Date(anchor);
    if (range === 'week') {
      const day = (d.getDay() + 6) % 7; // понедельник = 0
      const start = new Date(d.getFullYear(), d.getMonth(), d.getDate() - day);
      const end = new Date(start); end.setDate(start.getDate() + 6);
      return { start, end };
    }
    if (range === 'quarter') {
      const q = Math.floor(d.getMonth() / 3);
      const start = new Date(d.getFullYear(), q * 3, 1);
      const end = new Date(d.getFullYear(), q * 3 + 3, 0);
      return { start, end };
    }
    // month
    const start = new Date(d.getFullYear(), d.getMonth(), 1);
    const end = new Date(d.getFullYear(), d.getMonth() + 1, 0);
    return { start, end };
  }

  function shiftAnchor(delta) {
    const a = new Date(ssState.anchor);
    if (ssState.range === 'week') a.setDate(a.getDate() + 7 * delta);
    else if (ssState.range === 'quarter') a.setMonth(a.getMonth() + 3 * delta);
    else a.setMonth(a.getMonth() + delta);
    ssState.anchor = a;
    loadSellerStats();
  }

  function periodLabel(range, start, end) {
    const fmt = new Intl.DateTimeFormat('ru-RU', { day:'numeric', month:'short' });
    if (range === 'week') return fmt.format(start) + ' — ' + fmt.format(end);
    if (range === 'quarter') {
      const q = Math.floor(start.getMonth() / 3) + 1;
      return `Q${q} ${start.getFullYear()}`;
    }
    return start.toLocaleDateString('ru-RU', { month:'long', year:'numeric' });
  }

  function isoDate(d) {
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  }

  async function loadSellerStats() {
    const { start, end } = periodBounds(ssState.range, ssState.anchor);
    const periodEl = $('#ss-period');
    if (periodEl) periodEl.textContent = periodLabel(ssState.range, start, end);

    // Тянем строки seller_daily_reports + список зарегистрированных менеджеров
    // (из таблицы sellers — только их и показываем) + users для маппинга email→id.
    const [reportsRes, usersRes, sellersRes] = await Promise.all([
      sb.from('seller_daily_reports').select('*')
        .gte('report_date', isoDate(start))
        .lte('report_date', isoDate(end)),
      sb.from('users').select('id, full_name, email, roles'),
      sb.from('sellers').select('id, name, login, is_active'),
    ]);
    if (reportsRes.error) { toast(reportsRes.error.message, 'error'); return; }
    if (sellersRes.error) { toast(sellersRes.error.message, 'error'); return; }

    // Карта users по email (login в sellers = email менеджера).
    const userByEmail = {};
    for (const u of (usersRes.data || [])) {
      if (u.email) userByEmail[u.email.toLowerCase()] = u;
    }

    // Множество user.id, которые соответствуют зарегистрированным менеджерам.
    const allowedUserIds = new Set();
    const sellersList = sellersRes.data || [];
    for (const s of sellersList) {
      const u = userByEmail[(s.login || '').toLowerCase()];
      if (u) allowedUserIds.add(u.id);
    }

    // Только отчёты разрешённых менеджеров.
    const rows = (reportsRes.data || []).filter(r => allowedUserIds.has(r.seller_id));

    // KPI: суммы по всем полям.
    const totals = {};
    for (const f of SS_FIELDS) totals[f.key] = 0;
    for (const r of rows) for (const f of SS_FIELDS) totals[f.key] += r[f.key] || 0;

    const grid = $('#ss-kpis');
    if (grid) {
      grid.innerHTML = SS_FIELDS.map(f => `
        <div class="ss-kpi" style="--kpi-c:${f.color}">
          <div class="ss-kpi-label">${escapeHtml(f.label)}</div>
          <div class="ss-kpi-value">${totals[f.key]}</div>
        </div>`).join('');
    }

    // Группировка по менеджерам — стартуем с полного списка из sellers.
    const bySeller = new Map();
    for (const s of sellersList) {
      const u = userByEmail[(s.login || '').toLowerCase()];
      bySeller.set(s.id, {
        userId: u?.id || null,
        name: s.name || u?.full_name || s.login || '—',
        email: s.login || '',
        totals: Object.fromEntries(SS_FIELDS.map(f => [f.key, 0])),
      });
    }
    for (const r of rows) {
      for (const b of bySeller.values()) {
        if (b.userId === r.seller_id) {
          for (const f of SS_FIELDS) b.totals[f.key] += r[f.key] || 0;
          break;
        }
      }
    }

    const tbody = $('#ss-by-seller tbody');
    if (tbody) {
      const list = [...bySeller.values()].sort((a, b) =>
        (b.totals.signed_and_paid - a.totals.signed_and_paid) ||
        a.name.localeCompare(b.name, 'ru'));
      if (!list.length) {
        tbody.innerHTML = `<tr><td colspan="6" class="empty">Менеджеры пока не добавлены — сделайте это во вкладке «Менеджеры».</td></tr>`;
      } else {
        tbody.innerHTML = list.map(s => `
          <tr>
            <td>
              <div style="font-weight:600;">${escapeHtml(s.name)}</div>
              <div style="font-size:12px;color:var(--muted);">${escapeHtml(s.email)}</div>
            </td>
            <td>${s.totals.meetings_scheduled}</td>
            <td>${s.totals.meetings_held}</td>
            <td>${s.totals.agreed_to_test}</td>
            <td>${s.totals.launched_on_test}</td>
            <td><b>${s.totals.signed_and_paid}</b></td>
          </tr>`).join('');
      }
    }
  }

  function wireSellerStats() {
    $('#ss-prev')?.addEventListener('click', () => shiftAnchor(-1));
    $('#ss-next')?.addEventListener('click', () => shiftAnchor(1));
    $('#ss-range')?.addEventListener('change', (e) => {
      ssState.range = e.target.value;
      loadSellerStats();
    });
  }

  async function confirmDelete(name) {
    return confirmDialog({
      title: 'Удалить?',
      message: `«${name}» будет удалён. Действие необратимо.`,
      okText: 'Удалить', cancelText: 'Отмена', danger: true,
    });
  }

  // ============================================================
  // РУБРИКИ
  // ============================================================
  let categoriesCache = [];

  async function loadCategories() {
    const tbody = document.querySelector('#cat-table tbody');
    if (!tbody) return;
    const { data, error } = await sb.from('categories').select('*').order('sort_order');
    if (error) { toast('Ошибка: ' + error.message, 'error'); return; }
    categoriesCache = data || [];
    if (!categoriesCache.length) {
      tbody.innerHTML = `<tr><td colspan="4" class="empty">Пока нет рубрик</td></tr>`;
      return;
    }
    tbody.innerHTML = categoriesCache.map(c => `
      <tr>
        <td><strong>${escapeHtml(c.name)}</strong></td>
        <td style="font-size:22px;">${escapeHtml(c.icon || '')}</td>
        <td>${c.sort_order}</td>
        <td class="actions-cell">
          <button class="btn sm" data-edit="${c.id}">Редактировать</button>
          <button class="btn sm danger" data-del="${c.id}">Удалить</button>
        </td>
      </tr>`).join('');
    tbody.querySelectorAll('[data-edit]').forEach(b => b.addEventListener('click', () => editCategory(b.dataset.edit)));
    tbody.querySelectorAll('[data-del]').forEach(b => b.addEventListener('click', () => deleteCategory(b.dataset.del)));
  }

  $('#cat-add')?.addEventListener('click', () => editCategory(null));

  function editCategory(id) {
    const c = id ? categoriesCache.find(x => x.id === id) : { name:'', icon:'📁', sort_order:0 };
    openModal(id ? 'Редактировать рубрику' : 'Новая рубрика', `
      <form class="form-grid" id="cat-form">
        <label><div class="lbl">Название</div>
          <input type="text" name="name" value="${escapeHtml(c.name)}" required></label>
        <label><div class="lbl">Иконка (эмодзи)</div>
          <input type="text" name="icon" value="${escapeHtml(c.icon || '')}" maxlength="4"></label>
        <label><div class="lbl">Порядок сортировки</div>
          <input type="number" name="sort_order" value="${c.sort_order ?? 0}"></label>
        <div class="row"><button type="submit" class="btn primary">Сохранить</button>
          <button type="button" class="btn" id="cancel">Отмена</button></div>
      </form>`);
    document.getElementById('cancel').addEventListener('click', closeModal);
    document.getElementById('cat-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const payload = {
        name: fd.get('name'),
        icon: fd.get('icon'),
        sort_order: Number(fd.get('sort_order')) || 0,
      };
      const { data: saved, error } = id
        ? await sb.from('categories').update(payload).eq('id', id).select().maybeSingle()
        : await sb.from('categories').insert(payload).select().maybeSingle();
      if (error) { toast('Ошибка: ' + error.message, 'error'); return; }
      if (window.audit) audit.save('categories', !id, saved?.id || id, payload);
      closeModal(); toast('Сохранено'); loadCategories(); loadObjections();
    });
  }

  async function deleteCategory(id) {
    const c = categoriesCache.find(x => x.id === id);
    if (!c) return;
    const { count } = await sb.from('objections').select('id', { count:'exact', head:true }).eq('category_id', id);
    let action = 'orphan';
    if (count && count > 0) {
      const choice = prompt(
        `В рубрике «${c.name}» есть ${count} возражений.\n` +
        `Что сделать?\n\n` +
        `  1 — удалить вместе с рубрикой\n` +
        `  2 — оставить их без рубрики\n\n` +
        `Введите 1 или 2:`, '2');
      if (choice === null) return;
      action = choice === '1' ? 'delete' : 'orphan';
    } else {
      if (!await confirmDelete(c.name)) return;
    }
    if (action === 'delete') {
      const { error: e1 } = await sb.from('objections').delete().eq('category_id', id);
      if (e1) { toast('Ошибка: ' + e1.message, 'error'); return; }
    } else {
      const { error: e1 } = await sb.from('objections').update({ category_id: null }).eq('category_id', id);
      if (e1) { toast('Ошибка: ' + e1.message, 'error'); return; }
    }
    const { error } = await sb.from('categories').delete().eq('id', id);
    if (error) { toast('Ошибка: ' + error.message, 'error'); return; }
    if (window.audit) audit.del('categories', id, c.name);
    toast('Удалено'); loadCategories(); loadObjections();
  }

  // ============================================================
  // ВОЗРАЖЕНИЯ
  // ============================================================
  let objectionsCache = [];

  async function loadObjections() {
    const tbody = document.querySelector('#obj-table tbody');
    if (!tbody) return;
    const [objRes, cmtRes] = await Promise.all([
      sb.from('objections').select('*').order('sort_order'),
      sb.from('objection_comments').select('objection_id'),
    ]);
    if (objRes.error) { toast('Ошибка: ' + objRes.error.message, 'error'); return; }
    objectionsCache = objRes.data || [];

    const commentCounts = {};
    (cmtRes.data || []).forEach(c => {
      commentCounts[c.objection_id] = (commentCounts[c.objection_id] || 0) + 1;
    });

    if (!objectionsCache.length) {
      tbody.innerHTML = `<tr><td colspan="6" class="empty">Пока нет возражений</td></tr>`;
      return;
    }
    tbody.innerHTML = objectionsCache.map(o => {
      const catName = o.is_general
        ? '<span class="badge">Общее</span>'
        : (o.category_id
            ? `<span class="badge muted">${escapeHtml(categoriesCache.find(c => c.id === o.category_id)?.name || '—')}</span>`
            : '<span class="badge muted">Без рубрики</span>');
      const n = commentCounts[o.id] || 0;
      const cmtCell = n > 0
        ? `<button class="btn sm" data-comments="${o.id}">💬 ${n}</button>`
        : '<span class="muted" style="font-size:13px;">—</span>';
      return `
      <tr>
        <td><strong>${escapeHtml(o.title)}</strong></td>
        <td>${catName}</td>
        <td>${o.is_active ? '<span class="badge">Активно</span>' : '<span class="badge off">Скрыто</span>'}</td>
        <td>${cmtCell}</td>
        <td>${o.sort_order}</td>
        <td class="actions-cell">
          <button class="btn sm" data-edit="${o.id}">Ред.</button>
          <button class="btn sm" data-toggle="${o.id}">${o.is_active ? 'Скрыть' : 'Показать'}</button>
          <button class="btn sm danger" data-del="${o.id}">Удалить</button>
        </td>
      </tr>`;
    }).join('');
    tbody.querySelectorAll('[data-edit]').forEach(b => b.addEventListener('click', () => editObjection(b.dataset.edit)));
    tbody.querySelectorAll('[data-toggle]').forEach(b => b.addEventListener('click', () => toggleObjection(b.dataset.toggle)));
    tbody.querySelectorAll('[data-del]').forEach(b => b.addEventListener('click', () => deleteObjection(b.dataset.del)));
    tbody.querySelectorAll('[data-comments]').forEach(b => b.addEventListener('click', () => viewComments(b.dataset.comments)));
  }

  async function viewComments(objectionId) {
    const o = objectionsCache.find(x => x.id === objectionId);
    if (!o) return;
    openModal(`Комментарии: ${o.title}`, `<div id="cmt-container"><div class="empty">Загружаем…</div></div>`);
    await loadCommentsInto(objectionId);
  }

  async function loadCommentsInto(objectionId) {
    const { data, error } = await sb.from('objection_comments')
      .select('*').eq('objection_id', objectionId).order('created_at', { ascending: false });
    const container = document.getElementById('cmt-container');
    if (!container) return;
    if (error) { container.innerHTML = `<div class="empty">Ошибка: ${escapeHtml(error.message)}</div>`; return; }
    if (!data.length) { container.innerHTML = `<div class="empty">Пока нет комментариев.</div>`; return; }
    container.innerHTML = `<div class="comments-list">${data.map(c => `
      <div class="comment-card">
        <div class="meta">
          <span>${new Date(c.created_at).toLocaleString('ru-RU')}</span>
          <button class="btn sm danger" data-cmt-del="${c.id}">Удалить</button>
        </div>
        <div class="text">${escapeHtml(c.comment_text)}</div>
      </div>`).join('')}</div>`;
    container.querySelectorAll('[data-cmt-del]').forEach(b => b.addEventListener('click', async () => {
      const ok = await confirmDialog({
        title: 'Удалить комментарий?',
        message: 'Действие необратимо.',
        okText: 'Удалить', cancelText: 'Отмена', danger: true,
      });
      if (!ok) return;
      const { error } = await sb.from('objection_comments').delete().eq('id', b.dataset.cmtDel);
      if (error) { toast('Ошибка: ' + error.message, 'error'); return; }
      if (window.audit) audit.del('objection_comments', b.dataset.cmtDel, null);
      toast('Удалено');
      await loadCommentsInto(objectionId);
      loadObjections();
    }));
  }

  $('#obj-add')?.addEventListener('click', () => editObjection(null));

  function editObjection(id) {
    const o = id ? objectionsCache.find(x => x.id === id) : { title:'', answer:'', details:'', category_id:null, is_general:true, keywords:'', sort_order:0, is_active:true };
    const catOptions = categoriesCache.map(c =>
      `<option value="${c.id}" ${o.category_id === c.id ? 'selected' : ''}>${escapeHtml(c.name)}</option>`).join('');
    openModal(id ? 'Редактировать возражение' : 'Новое возражение', `
      <form class="form-grid" id="obj-form">
        <label><div class="lbl">Заголовок (что говорит клиент)</div>
          <input type="text" name="title" value="${escapeHtml(o.title)}" required></label>
        <label><div class="lbl">Текст ответа <span class="muted" style="font-weight:400;">— редактор с форматированием; жирный, размеры, списки — сохранятся при вставке из Google Docs / Word</span></div>
          <div class="rte" id="answer-editor"></div></label>
        <label><div class="lbl">Подробно о возражении <span class="muted" style="font-weight:400;">— оператор откроет этот текст кнопкой «📖 Подробно о возражении». Объясните суть возражения. Не обязательно.</span></div>
          <div class="rte" id="details-editor"></div></label>
        <label class="inline">
          <input type="checkbox" name="is_general" ${o.is_general ? 'checked' : ''}>
          <span>Общее возражение (показывать во всех рубриках)</span>
        </label>
        <label><div class="lbl">Рубрика (для не-общих)</div>
          <select name="category_id">
            <option value="">— Без рубрики —</option>
            ${catOptions}
          </select></label>
        <label><div class="lbl">Ключевые слова для поиска (через запятую)</div>
          <input type="text" name="keywords" value="${escapeHtml(o.keywords || '')}" placeholder="премиум, элитные, дорогие"></label>
        <label><div class="lbl">Порядок сортировки</div>
          <input type="number" name="sort_order" value="${o.sort_order ?? 0}"></label>
        <label class="inline">
          <input type="checkbox" name="is_active" ${o.is_active ? 'checked' : ''}>
          <span>Активно (показывать оператору)</span>
        </label>
        <div class="row"><button type="submit" class="btn primary">Сохранить</button>
          <button type="button" class="btn" id="cancel">Отмена</button></div>
      </form>`);
    document.getElementById('cancel').addEventListener('click', closeModal);

    const answerQuill = mountQuillEditor('#answer-editor', o.answer || '');
    const detailsQuill = mountQuillEditor('#details-editor', o.details || '');

    document.getElementById('obj-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const isGeneral = fd.get('is_general') === 'on';
      const payload = {
        title: fd.get('title'),
        answer: quillHtml(answerQuill),
        details: quillHtml(detailsQuill),
        is_general: isGeneral,
        category_id: isGeneral ? null : (fd.get('category_id') || null),
        keywords: fd.get('keywords') || '',
        sort_order: Number(fd.get('sort_order')) || 0,
        is_active: fd.get('is_active') === 'on',
      };
      if (!payload.answer.trim()) { toast('Заполните текст ответа', 'error'); return; }
      const { data: saved, error } = id
        ? await sb.from('objections').update(payload).eq('id', id).select().maybeSingle()
        : await sb.from('objections').insert(payload).select().maybeSingle();
      if (error) { toast('Ошибка: ' + error.message, 'error'); return; }
      if (window.audit) audit.save('objections', !id, saved?.id || id, { title: payload.title, is_general: payload.is_general, is_active: payload.is_active });
      closeModal(); toast('Сохранено'); loadObjections();
    });
  }

  function mountQuillEditor(selector, initialHtml) {
    if (typeof Quill === 'undefined') {
      const el = document.querySelector(selector);
      if (!el) return null;
      const ta = document.createElement('textarea');
      ta.value = initialHtml || '';
      ta.style.width = '100%'; ta.style.minHeight = '160px';
      el.replaceWith(ta);
      return { root: ta, _isTextarea: true };
    }
    const quill = new Quill(selector, {
      theme: 'snow',
      modules: {
        toolbar: [
          [{ 'header': [1, 2, 3, false] }],
          [{ 'size': ['small', false, 'large', 'huge'] }],
          ['bold', 'italic', 'underline', 'strike'],
          [{ 'color': [] }, { 'background': [] }],
          [{ 'list': 'ordered' }, { 'list': 'bullet' }],
          [{ 'align': [] }],
          ['link', 'blockquote'],
          ['clean'],
        ],
      },
      placeholder: 'Введите текст или вставьте из документа — форматирование сохранится',
    });
    if (initialHtml) quill.root.innerHTML = initialHtml;
    return quill;
  }

  function quillHtml(editor) {
    if (!editor) return '';
    if (editor._isTextarea) return editor.root.value.trim();
    const html = editor.root.innerHTML.trim();
    return html === '<p><br></p>' ? '' : html;
  }

  async function toggleObjection(id) {
    const o = objectionsCache.find(x => x.id === id);
    const { error } = await sb.from('objections').update({ is_active: !o.is_active }).eq('id', id);
    if (error) { toast('Ошибка: ' + error.message, 'error'); return; }
    if (window.audit) audit.log({ action: 'objections_toggle_active', target_type: 'objections', target_id: id, metadata: { title: o.title, is_active: !o.is_active } });
    loadObjections();
  }

  async function deleteObjection(id) {
    const o = objectionsCache.find(x => x.id === id);
    if (!o || !await confirmDelete(o.title)) return;
    const { error } = await sb.from('objections').delete().eq('id', id);
    if (error) { toast('Ошибка: ' + error.message, 'error'); return; }
    if (window.audit) audit.del('objections', id, o.title);
    toast('Удалено'); loadObjections();
  }

  // ============================================================
  // ШПАРГАЛКА
  // ============================================================
  let cheatCache = [];

  async function loadCheatsheet() {
    const tbody = document.querySelector('#cheat-table tbody');
    if (!tbody) return;
    const { data, error } = await sb.from('cheatsheet_blocks').select('*').order('sort_order');
    if (error) { toast('Ошибка: ' + error.message, 'error'); return; }
    cheatCache = data || [];
    if (!cheatCache.length) {
      tbody.innerHTML = `<tr><td colspan="3" class="empty">Пока нет блоков</td></tr>`;
      return;
    }
    tbody.innerHTML = cheatCache.map(b => `
      <tr>
        <td><strong>${escapeHtml(b.title)}</strong></td>
        <td>${b.sort_order}</td>
        <td class="actions-cell">
          <button class="btn sm" data-edit="${b.id}">Ред.</button>
          <button class="btn sm danger" data-del="${b.id}">Удалить</button>
        </td>
      </tr>`).join('');
    tbody.querySelectorAll('[data-edit]').forEach(b => b.addEventListener('click', () => editCheat(b.dataset.edit)));
    tbody.querySelectorAll('[data-del]').forEach(b => b.addEventListener('click', () => deleteCheat(b.dataset.del)));
  }

  $('#cheat-add')?.addEventListener('click', () => editCheat(null));

  function editCheat(id) {
    const b = id ? cheatCache.find(x => x.id === id) : { title:'', content:'', sort_order:0 };
    openModal(id ? 'Редактировать блок' : 'Новый блок шпаргалки', `
      <form class="form-grid" id="cheat-form">
        <label><div class="lbl">Заголовок</div>
          <input type="text" name="title" value="${escapeHtml(b.title)}" required></label>
        <label><div class="lbl">Текст (поддерживает **жирный**, списки через -, переносы строк)</div>
          <textarea name="content" required>${escapeHtml(b.content)}</textarea></label>
        <label><div class="lbl">Порядок сортировки</div>
          <input type="number" name="sort_order" value="${b.sort_order ?? 0}"></label>
        <div class="row"><button type="submit" class="btn primary">Сохранить</button>
          <button type="button" class="btn" id="cancel">Отмена</button></div>
      </form>`);
    document.getElementById('cancel').addEventListener('click', closeModal);
    document.getElementById('cheat-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const payload = {
        title: fd.get('title'),
        content: fd.get('content'),
        sort_order: Number(fd.get('sort_order')) || 0,
      };
      const { data: saved, error } = id
        ? await sb.from('cheatsheet_blocks').update(payload).eq('id', id).select().maybeSingle()
        : await sb.from('cheatsheet_blocks').insert(payload).select().maybeSingle();
      if (error) { toast('Ошибка: ' + error.message, 'error'); return; }
      if (window.audit) audit.save('cheatsheet_blocks', !id, saved?.id || id, { title: payload.title });
      closeModal(); toast('Сохранено'); loadCheatsheet();
    });
  }

  async function deleteCheat(id) {
    const b = cheatCache.find(x => x.id === id);
    if (!b || !await confirmDelete(b.title)) return;
    const { error } = await sb.from('cheatsheet_blocks').delete().eq('id', id);
    if (error) { toast('Ошибка: ' + error.message, 'error'); return; }
    if (window.audit) audit.del('cheatsheet_blocks', id, b.title);
    toast('Удалено'); loadCheatsheet();
  }

  // ============================================================
  // ДОКУМЕНТЫ
  // ============================================================
  let docsCache = [];

  async function loadDocuments() {
    const tbody = document.querySelector('#doc-table tbody');
    if (!tbody) return;
    const { data, error } = await sb.from('documents').select('*').order('sort_order');
    if (error) { toast('Ошибка: ' + error.message, 'error'); return; }
    docsCache = data || [];
    if (!docsCache.length) {
      tbody.innerHTML = `<tr><td colspan="4" class="empty">Пока нет документов</td></tr>`;
      return;
    }
    tbody.innerHTML = docsCache.map(d => `
      <tr>
        <td><strong>${escapeHtml(d.name)}</strong>${d.description ? `<br><span class="muted" style="font-size:12px;">${escapeHtml(d.description)}</span>` : ''}</td>
        <td><a href="${escapeHtml(d.url)}" target="_blank" style="font-size:12px;">${escapeHtml(d.url.slice(0, 40))}${d.url.length > 40 ? '…' : ''}</a></td>
        <td>${d.sort_order}</td>
        <td class="actions-cell">
          <button class="btn sm" data-edit="${d.id}">Ред.</button>
          <button class="btn sm danger" data-del="${d.id}">Удалить</button>
        </td>
      </tr>`).join('');
    tbody.querySelectorAll('[data-edit]').forEach(b => b.addEventListener('click', () => editDoc(b.dataset.edit)));
    tbody.querySelectorAll('[data-del]').forEach(b => b.addEventListener('click', () => deleteDoc(b.dataset.del)));
  }

  $('#doc-add')?.addEventListener('click', () => editDoc(null));

  function editDoc(id) {
    const d = id ? docsCache.find(x => x.id === id) : { name:'', url:'', description:'', sort_order:0 };
    openModal(id ? 'Редактировать документ' : 'Новый документ', `
      <form class="form-grid" id="doc-form">
        <label><div class="lbl">Название</div>
          <input type="text" name="name" value="${escapeHtml(d.name)}" required></label>
        <label><div class="lbl">URL (ссылка)</div>
          <input type="url" name="url" value="${escapeHtml(d.url)}" required placeholder="https://…"></label>
        <label><div class="lbl">Описание (необязательно)</div>
          <input type="text" name="description" value="${escapeHtml(d.description || '')}"></label>
        <label><div class="lbl">Порядок сортировки</div>
          <input type="number" name="sort_order" value="${d.sort_order ?? 0}"></label>
        <div class="row"><button type="submit" class="btn primary">Сохранить</button>
          <button type="button" class="btn" id="cancel">Отмена</button></div>
      </form>`);
    document.getElementById('cancel').addEventListener('click', closeModal);
    document.getElementById('doc-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const payload = {
        name: fd.get('name'),
        url: fd.get('url'),
        description: fd.get('description') || null,
        sort_order: Number(fd.get('sort_order')) || 0,
      };
      const { data: saved, error } = id
        ? await sb.from('documents').update(payload).eq('id', id).select().maybeSingle()
        : await sb.from('documents').insert(payload).select().maybeSingle();
      if (error) { toast('Ошибка: ' + error.message, 'error'); return; }
      if (window.audit) audit.save('documents', !id, saved?.id || id, { name: payload.name, url: payload.url });
      closeModal(); toast('Сохранено'); loadDocuments();
    });
  }

  async function deleteDoc(id) {
    const d = docsCache.find(x => x.id === id);
    if (!d || !await confirmDelete(d.name)) return;
    const { error } = await sb.from('documents').delete().eq('id', id);
    if (error) { toast('Ошибка: ' + error.message, 'error'); return; }
    if (window.audit) audit.del('documents', id, d.name);
    toast('Удалено'); loadDocuments();
  }

  // ---------- Старт ----------

  // Лениво подгружаем содержимое выбранной вкладки.
  document.querySelectorAll('#commercial-nav .seller-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      const sec = btn.dataset.section;
      if (sec === 'operators') loadOperators();
      if (sec === 'sellers') loadSellers();
      if (sec === 'categories') loadCategories();
      if (sec === 'objections') { loadCategories(); loadObjections(); }
      if (sec === 'cheatsheet') loadCheatsheet();
      if (sec === 'documents') loadDocuments();
      if (sec === 'stats-sellers') loadSellerStats();
    });
  });

  wireSellerStats();
  loadOperators();
  // Категории сразу подгружаем — они нужны для рендера badge'й в возражениях.
  loadCategories();
  // Если пришли по hash — подгрузим соответствующее.
  const initialHash = location.hash.replace('#', '');
  if (initialHash === 'categories')   loadCategories();
  if (initialHash === 'objections')   loadObjections();
  if (initialHash === 'cheatsheet')   loadCheatsheet();
  if (initialHash === 'documents')    loadDocuments();
  if (initialHash === 'stats-sellers') loadSellerStats();
})();
