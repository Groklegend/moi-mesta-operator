// ============================================================
// Логика админ-панели
// ============================================================

// Гардинг: только админ может видеть админку.
// cabinetShell проверит роль, нарисует переключатель ролей в шапке и привяжет logout.
(async () => {
  await cabinetShell.init({ requiredRole: 'admin', greetingPrefix: 'Админ' });
  init();
})();

const tabs = document.querySelectorAll('.admin-nav a[data-tab]');
tabs.forEach(a => a.addEventListener('click', (e) => {
  if (!a.dataset.tab) return;
  e.preventDefault();
  tabs.forEach(x => x.classList.remove('active'));
  a.classList.add('active');
  document.querySelectorAll('.tab').forEach(t => t.classList.add('hidden'));
  document.getElementById('tab-' + a.dataset.tab).classList.remove('hidden');
  location.hash = a.dataset.tab;
}));

function init() {
  // Переход по хэшу
  const hash = location.hash.replace('#','');
  if (hash) {
    const link = document.querySelector(`.admin-nav a[data-tab="${hash}"]`);
    if (link) link.click();
  }
  // Контент (рубрики/возражения/шпаргалка/документы) и операторы
  // переехали в кабинет коммерческого директора (commercial.html).
  loadUsers();
  initAuditTab();
}

// ---------- Модалка (универсальная) ----------
const modal = document.getElementById('modal');
const modalTitle = document.getElementById('modal-title');
const modalBody = document.getElementById('modal-body');
document.getElementById('modal-close').addEventListener('click', closeModal);
// Закрываем модалку кликом по подложке, только если клик и начался, и закончился на ней.
// Иначе выделение текста в поле с отпусканием за пределами формы закрывает модалку.
let _modalDownOnBackdrop = false;
modal.addEventListener('mousedown', e => { _modalDownOnBackdrop = (e.target.id === 'modal'); });
modal.addEventListener('click', e => {
  if (e.target.id === 'modal' && _modalDownOnBackdrop) closeModal();
  _modalDownOnBackdrop = false;
});
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeModal(); });

function openModal(title, bodyHtml) {
  modalTitle.textContent = title;
  modalBody.innerHTML = bodyHtml;
  modal.classList.remove('hidden');
}
function closeModal() { modal.classList.add('hidden'); }

function toast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.remove('hidden');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => t.classList.add('hidden'), 1800);
}

async function confirmDelete(name) {
  return confirmDialog({
    title: 'Удалить?',
    message: `«${name}» будет удалён. Действие необратимо.`,
    okText: 'Удалить', cancelText: 'Отмена', danger: true,
  });
}

// ============================================================
// Контент (рубрики, возражения, шпаргалка, документы) и операторы
// перенесены в кабинет коммерческого директора (commercial.html).
// Логика — в js/commercial.js. В админке остались только разделы,
// которые касаются всей системы: Пользователи, Настройки Гари,
// Сообщения от Гари, Журнал, Бэкап.
// ============================================================

// ============================================================
// ПОЛЬЗОВАТЕЛИ ХАБА (public.users + auth.users)
// ============================================================
// Чтение: select из public.users (RLS: админ видит всех).
// Изменение ролей и status: update public.users (RLS: админ может).
// Создание (приглашение): требует Auth Admin API → нужен Worker handler;
// пока заглушка показывает curl-команду для самостоятельного запуска.

const ROLE_LABELS = {
  admin: 'Админ',
  commercial: 'Коммерческий директор',
  operator: 'Оператор',
  seller: 'Менеджер',
  marketer: 'Маркетолог',
};
const ALL_ROLES = ['admin', 'commercial', 'operator', 'seller', 'marketer'];
let usersCache = [];

async function loadUsers() {
  const { data, error } = await sb
    .from('users')
    .select('id, email, full_name, roles, status, created_at')
    .order('created_at', { ascending: false });
  if (error) { toast('Ошибка users: ' + error.message); return; }
  usersCache = data || [];
  renderUsers();
}

function renderUsers() {
  const tbody = document.querySelector('#user-table tbody');
  const search = (document.getElementById('user-search')?.value || '').trim().toLowerCase();
  const activeFilters = ALL_ROLES.filter(r => document.getElementById('filter-' + r)?.checked);

  let list = usersCache;
  if (search) {
    list = list.filter(u =>
      (u.email || '').toLowerCase().includes(search) ||
      (u.full_name || '').toLowerCase().includes(search)
    );
  }
  if (activeFilters.length) {
    list = list.filter(u => activeFilters.every(r => (u.roles || []).includes(r)));
  }

  if (!list.length) {
    tbody.innerHTML = `<tr><td colspan="6" class="empty">Никого не найдено</td></tr>`;
    return;
  }
  tbody.innerHTML = list.map(u => {
    const roleBadges = (u.roles || []).map(r =>
      `<span class="role-badge role-${r}">${ROLE_LABELS[r] || r}</span>`
    ).join(' ') || '<span style="color:var(--muted);">—</span>';
    const statusBadge = u.status === 'active'
      ? '<span class="status-badge status-active">Активен</span>'
      : '<span class="status-badge status-disabled">Отключён</span>';
    const created = u.created_at ? new Date(u.created_at).toLocaleDateString('ru-RU') : '—';
    const toggleLabel = u.status === 'active' ? 'Отключить' : 'Включить';
    const toggleClass = u.status === 'active' ? 'danger' : 'primary';
    return `
      <tr>
        <td><strong>${escapeHtml(u.full_name || '—')}</strong></td>
        <td>${escapeHtml(u.email || '')}</td>
        <td>${roleBadges}</td>
        <td>${statusBadge}</td>
        <td style="white-space:nowrap;">${created}</td>
        <td class="actions-cell">
          <button class="btn sm" data-edit-user="${u.id}">Редактировать</button>
          <button class="btn sm ${toggleClass}" data-toggle-user="${u.id}">${toggleLabel}</button>
        </td>
      </tr>`;
  }).join('');
  tbody.querySelectorAll('[data-edit-user]').forEach(b =>
    b.addEventListener('click', () => editUser(b.dataset.editUser)));
  tbody.querySelectorAll('[data-toggle-user]').forEach(b =>
    b.addEventListener('click', () => toggleUserStatus(b.dataset.toggleUser)));
}

document.getElementById('user-add')?.addEventListener('click', () => inviteUserModal());
document.getElementById('user-search')?.addEventListener('input', renderUsers);
ALL_ROLES.forEach(r =>
  document.getElementById('filter-' + r)?.addEventListener('change', renderUsers));

function inviteUserModal() {
  const checks = ALL_ROLES.map(r => `
    <label class="inline">
      <input type="checkbox" name="role" value="${r}">
      <span>${ROLE_LABELS[r]}</span>
    </label>`).join('');
  openModal('Пригласить пользователя', `
    <form class="form-grid" id="invite-form">
      <label><div class="lbl">Email</div>
        <input type="email" name="email" required autocomplete="off"></label>
      <label><div class="lbl">Имя (необязательно)</div>
        <input type="text" name="full_name"></label>
      <div>
        <div class="lbl">Роли</div>
        <div style="display:flex;gap:16px;flex-wrap:wrap;">${checks}</div>
      </div>
      <div class="row">
        <button type="submit" class="btn primary" id="invite-submit">Отправить приглашение</button>
        <button type="button" class="btn" id="invite-cancel">Отмена</button>
      </div>
      <div class="error" id="invite-error" hidden></div>
    </form>`);
  document.getElementById('invite-cancel').addEventListener('click', closeModal);
  document.getElementById('invite-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const errEl = document.getElementById('invite-error');
    const btn = document.getElementById('invite-submit');
    errEl.hidden = true;
    const fd = new FormData(e.target);
    const email = (fd.get('email') || '').toString().trim();
    const full_name = (fd.get('full_name') || '').toString().trim();
    const roles = fd.getAll('role');
    if (!email || roles.length === 0) {
      errEl.textContent = 'Email и хотя бы одна роль обязательны';
      errEl.hidden = false;
      return;
    }
    btn.disabled = true; btn.textContent = 'Отправляем…';
    try {
      const { data: { session } } = await sb.auth.getSession();
      const resp = await fetch('/api/v1/admin/invite', {
        method: 'POST',
        headers: {
          authorization: `Bearer ${session?.access_token || ''}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ email, full_name, roles }),
      });
      const body = await resp.json().catch(() => ({}));
      if (!resp.ok) {
        const msg = body.detail ? `${body.error || resp.statusText} — ${body.detail}` : (body.error || resp.statusText);
        errEl.textContent = 'Ошибка: ' + msg;
        errEl.hidden = false;
        btn.disabled = false; btn.textContent = 'Отправить приглашение';
        return;
      }
      toast('Приглашение отправлено: ' + email);
      closeModal();
      loadUsers();
    } catch (err) {
      errEl.textContent = 'Сбой: ' + (err?.message || err);
      errEl.hidden = false;
      btn.disabled = false; btn.textContent = 'Отправить приглашение';
    }
  });
}

function editUser(id) {
  const u = usersCache.find(x => x.id === id);
  if (!u) return;
  const checks = ALL_ROLES.map(r => `
    <label class="inline">
      <input type="checkbox" name="role" value="${r}" ${(u.roles || []).includes(r) ? 'checked' : ''}>
      <span>${ROLE_LABELS[r]}</span>
    </label>`).join('');
  openModal('Редактировать пользователя', `
    <form class="form-grid" id="user-form">
      <label><div class="lbl">Email</div>
        <input type="email" name="email" value="${escapeHtml(u.email || '')}" required></label>
      <label><div class="lbl">Имя</div>
        <input type="text" name="full_name" value="${escapeHtml(u.full_name || '')}"></label>
      <div>
        <div class="lbl">Роли</div>
        <div style="display:flex;gap:16px;flex-wrap:wrap;">${checks}</div>
      </div>
      <div class="row">
        <button type="submit" class="btn primary" id="user-save">Сохранить</button>
        <button type="button" class="btn" id="user-cancel">Отмена</button>
      </div>
      <div class="error" id="user-error" hidden></div>
    </form>`);
  document.getElementById('user-cancel').addEventListener('click', closeModal);
  document.getElementById('user-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const errEl = document.getElementById('user-error');
    const btn = document.getElementById('user-save');
    errEl.hidden = true;
    const fd = new FormData(e.target);
    const newEmail = (fd.get('email') || '').toString().trim();
    const full_name = (fd.get('full_name') || '').toString().trim();
    const roles = fd.getAll('role');
    btn.disabled = true; btn.textContent = 'Сохраняем…';

    // Смена email требует service_role → идём через Worker.
    if (newEmail && newEmail.toLowerCase() !== (u.email || '').toLowerCase()) {
      try {
        const { data: { session } } = await sb.auth.getSession();
        const resp = await fetch(`/api/v1/admin/users/${id}/email`, {
          method: 'PATCH',
          headers: {
            authorization: `Bearer ${session?.access_token || ''}`,
            'content-type': 'application/json',
          },
          body: JSON.stringify({ email: newEmail }),
        });
        if (!resp.ok) {
          const body = await resp.json().catch(() => ({}));
          const msg = body.detail ? `${body.error || resp.statusText} — ${body.detail}` : (body.error || resp.statusText);
          errEl.textContent = 'Email не сменился: ' + msg;
          errEl.hidden = false;
          btn.disabled = false; btn.textContent = 'Сохранить';
          return;
        }
      } catch (err) {
        errEl.textContent = 'Сбой смены email: ' + (err?.message || err);
        errEl.hidden = false;
        btn.disabled = false; btn.textContent = 'Сохранить';
        return;
      }
    }

    // full_name + roles — обычный update под RLS админа.
    const { error } = await sb.from('users').update({ full_name, roles }).eq('id', id);
    if (error) {
      errEl.textContent = 'Ошибка: ' + error.message;
      errEl.hidden = false;
      btn.disabled = false; btn.textContent = 'Сохранить';
      return;
    }
    audit.log({ action: 'user_update', target_type: 'users', target_id: id, metadata: { full_name, roles } });
    toast('Сохранено');
    closeModal();
    loadUsers();
  });
}

async function toggleUserStatus(id) {
  const u = usersCache.find(x => x.id === id);
  if (!u) return;
  const newStatus = u.status === 'active' ? 'disabled' : 'active';
  const verb = newStatus === 'active' ? 'включить' : 'отключить';
  const ok = await confirmDialog({
    title: `Точно ${verb}?`,
    message: `Пользователь «${u.email}» будет ${newStatus === 'active' ? 'включён' : 'отключён'}.`,
    okText: verb.charAt(0).toUpperCase() + verb.slice(1),
    cancelText: 'Отмена',
    danger: newStatus !== 'active',
  });
  if (!ok) return;
  const { error } = await sb.from('users').update({ status: newStatus }).eq('id', id);
  if (error) { toast('Ошибка: ' + error.message); return; }
  audit.log({ action: 'user_status_change', target_type: 'users', target_id: id, metadata: { email: u.email, new_status: newStatus } });
  toast(newStatus === 'active' ? 'Включён' : 'Отключён');
  loadUsers();
}

// ============================================================
// ЖУРНАЛ ДЕЙСТВИЙ (audit_log)
// ============================================================
const AUDIT_PAGE_SIZE = 50;
const auditState = { page: 0, total: 0 };

const ACTION_LABELS = {
  login: 'Вход',
  login_failed: 'Неудачный вход',
  logout: 'Выход',
  user_invite: 'Инвайт',
  user_update: 'Изменение пользователя',
  user_email_change: 'Смена email',
  user_status_change: 'Вкл/откл пользователя',
  categories_create: 'Создание рубрики',
  categories_update: 'Изменение рубрики',
  categories_delete: 'Удаление рубрики',
  objections_create: 'Создание возражения',
  objections_update: 'Изменение возражения',
  objections_delete: 'Удаление возражения',
  objections_toggle_active: 'Активация возражения',
  objection_comments_delete: 'Удаление комментария',
  cheatsheet_blocks_create: 'Создание блока шпаргалки',
  cheatsheet_blocks_update: 'Изменение блока шпаргалки',
  cheatsheet_blocks_delete: 'Удаление блока шпаргалки',
  documents_create: 'Создание документа',
  documents_update: 'Изменение документа',
  documents_delete: 'Удаление документа',
  operators_create: 'Создание оператора',
  operators_update: 'Изменение оператора',
  operators_delete: 'Удаление оператора',
};

function initAuditTab() {
  const fromEl = document.getElementById('audit-from');
  const toEl = document.getElementById('audit-to');
  if (!fromEl) return; // вкладка может отсутствовать на старых страницах
  // По умолчанию — последние 7 дней.
  const today = new Date();
  const weekAgo = new Date(today.getTime() - 6 * 24 * 60 * 60 * 1000);
  toEl.value = today.toISOString().slice(0, 10);
  fromEl.value = weekAgo.toISOString().slice(0, 10);

  ['audit-from','audit-to','audit-user','audit-action'].forEach(id => {
    const el = document.getElementById(id);
    el?.addEventListener('change', () => { auditState.page = 0; loadAudit(); });
  });
  document.getElementById('audit-user')?.addEventListener('input', debounce(() => {
    auditState.page = 0; loadAudit();
  }, 300));
  document.getElementById('audit-refresh')?.addEventListener('click', loadAudit);

  // Если открыта прямо вкладка журнала — подгрузим сразу.
  if (location.hash === '#audit') loadAudit();
  // Иначе подгрузим лениво при первом клике.
  document.querySelector('.admin-nav a[data-tab="audit"]')?.addEventListener('click', () => {
    if (!auditState._loaded) loadAudit();
  });
}

function debounce(fn, ms) {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}

async function loadAudit() {
  const tbody = document.querySelector('#audit-table tbody');
  if (!tbody) return;
  tbody.innerHTML = `<tr><td colspan="6" class="empty">Загрузка…</td></tr>`;

  const fromVal = document.getElementById('audit-from').value;
  const toVal = document.getElementById('audit-to').value;
  const userQ = document.getElementById('audit-user').value.trim();
  const action = document.getElementById('audit-action').value;

  let q = sb.from('audit_log').select('*', { count: 'exact' });
  if (fromVal) q = q.gte('created_at', fromVal + 'T00:00:00');
  if (toVal) q = q.lte('created_at', toVal + 'T23:59:59');
  if (action) q = q.eq('action', action);
  if (userQ) q = q.ilike('user_email', `%${userQ}%`);

  const start = auditState.page * AUDIT_PAGE_SIZE;
  const { data, error, count } = await q
    .order('created_at', { ascending: false })
    .range(start, start + AUDIT_PAGE_SIZE - 1);

  if (error) {
    tbody.innerHTML = `<tr><td colspan="6" class="empty">Ошибка: ${escapeHtml(error.message)}</td></tr>`;
    return;
  }
  auditState.total = count || 0;
  auditState._loaded = true;

  if (!data || data.length === 0) {
    tbody.innerHTML = `<tr><td colspan="6" class="empty">Записей нет</td></tr>`;
  } else {
    tbody.innerHTML = data.map(row => {
      const dt = row.created_at ? new Date(row.created_at).toLocaleString('ru-RU') : '';
      const who = row.is_agent ? 'Гари' : (escapeHtml(row.user_email || '—'));
      const act = ACTION_LABELS[row.action] || row.action;
      const target = row.target_type
        ? `${escapeHtml(row.target_type)}${row.target_id ? ` <span class="muted" style="font-size:11px;">${escapeHtml(String(row.target_id).slice(0, 8))}</span>` : ''}`
        : '<span class="muted">—</span>';
      const ip = escapeHtml(row.ip_address || '—');
      const ua = shortUA(row.user_agent);
      return `<tr title="${escapeHtml(JSON.stringify(row.metadata || {}, null, 2))}">
        <td style="white-space:nowrap;">${dt}</td>
        <td>${who}</td>
        <td><b>${act}</b></td>
        <td>${target}</td>
        <td style="font-size:12px;">${ip}</td>
        <td style="font-size:12px;color:var(--muted);">${ua}</td>
      </tr>`;
    }).join('');
  }

  renderAuditPager();
}

function shortUA(ua) {
  if (!ua) return '—';
  const u = String(ua);
  if (/iPhone|iPad/.test(u)) return 'iOS';
  if (/Android/.test(u))    return 'Android';
  if (/Edg\//.test(u))      return 'Edge';
  if (/Chrome\//.test(u))   return 'Chrome';
  if (/Firefox\//.test(u))  return 'Firefox';
  if (/Safari\//.test(u))   return 'Safari';
  return u.slice(0, 24) + '…';
}

function renderAuditPager() {
  const el = document.getElementById('audit-pager');
  if (!el) return;
  const pages = Math.max(1, Math.ceil(auditState.total / AUDIT_PAGE_SIZE));
  const cur = auditState.page;
  el.innerHTML = `
    <button class="btn sm" id="audit-prev" ${cur === 0 ? 'disabled' : ''}>← Назад</button>
    <span style="color:var(--muted);font-size:13px;">
      Страница ${cur + 1} из ${pages} · Всего: ${auditState.total}
    </span>
    <button class="btn sm" id="audit-next" ${cur >= pages - 1 ? 'disabled' : ''}>Вперёд →</button>
  `;
  document.getElementById('audit-prev')?.addEventListener('click', () => { auditState.page--; loadAudit(); });
  document.getElementById('audit-next')?.addEventListener('click', () => { auditState.page++; loadAudit(); });
}
