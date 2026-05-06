// ============================================================
// Каркас кабинета: гард по сессии, переключатель ролей, логаут
// Используется на seller.html / marketer.html / hub.html.
// ============================================================
//
// API: cabinetShell.init({ requiredRole, greetingPrefix })
//   requiredRole — слаг роли, которая должна быть у юзера для этого кабинета:
//     'seller', 'marketer', 'admin' или null/undefined для hub.html
//     (просто показать главную с переключателем).
//   greetingPrefix — текст до имени, например 'Здравствуйте'.
//
// Что делает:
//   1. Берёт public.users по auth.uid().
//   2. Если сессии нет / роли нет / status=disabled — кидает на login.html.
//   3. Подставляет имя в #greeting и email в #user-email.
//   4. Если у юзера 2+ ролей — рисует переключатель ролей в #role-switcher.
//   5. Подключает кнопку #logout.

(function () {
  // Кабинеты в порядке отображения в переключателе
  // (operator идёт первым, чтобы знакомым ролям было привычно)
  const CABINETS = [
    { role: 'operator',   label: 'Оператор',              page: 'index.html'      },
    { role: 'seller',     label: 'Менеджер',              page: 'seller.html'     },
    { role: 'marketer',   label: 'Маркетолог',            page: 'marketer.html'   },
    { role: 'commercial', label: 'Коммерческий директор', page: 'commercial.html' },
    { role: 'admin',      label: 'Админка',               page: 'admin.html'      },
  ];

  let bellPollTimer = null;
  let currentUserId = null;

  // Создаёт элемент колокольчика и вставляет ПЕРЕД элементом-якорем (обычно user-email).
  // Если в DOM уже есть #bell — переиспользует.
  function ensureBell() {
    let bell = document.getElementById('bell');
    if (bell) return bell;
    const anchor = document.getElementById('user-email');
    if (!anchor || !anchor.parentElement) return null;
    bell = document.createElement('div');
    bell.id = 'bell';
    bell.className = 'bell';
    bell.innerHTML = `
      <button type="button" class="bell-btn" id="bell-btn" aria-label="Уведомления">
        <span class="bell-icon">🔔</span>
        <span class="bell-count" id="bell-count" hidden>0</span>
      </button>
      <div class="bell-dropdown hidden" id="bell-dropdown">
        <div class="bell-head">
          <span>Уведомления</span>
          <button type="button" class="link" id="bell-mark-all">Прочитать всё</button>
        </div>
        <div class="bell-list" id="bell-list">
          <div class="bell-empty">Загрузка…</div>
        </div>
        <a class="bell-footer" href="notifications.html">Все уведомления →</a>
      </div>`;
    anchor.parentElement.insertBefore(bell, anchor);
    // Тогглы и обработчики
    document.getElementById('bell-btn').addEventListener('click', toggleBellDropdown);
    document.getElementById('bell-mark-all').addEventListener('click', markAllRead);
    document.addEventListener('click', (e) => {
      if (!bell.contains(e.target)) closeBellDropdown();
    });
    return bell;
  }

  async function refreshBell() {
    if (!currentUserId) return;
    const { data, error } = await sb
      .from('notifications')
      .select('id, title, body, link, is_read, created_at')
      .eq('user_id', currentUserId)
      .order('created_at', { ascending: false })
      .limit(10);
    if (error) { console.error('notifications:', error); return; }
    const unread = (data || []).filter(n => !n.is_read).length;
    const countEl = document.getElementById('bell-count');
    if (countEl) {
      countEl.textContent = unread > 99 ? '99+' : String(unread);
      countEl.hidden = unread === 0;
    }
    const list = document.getElementById('bell-list');
    if (!list) return;
    if (!data || data.length === 0) {
      list.innerHTML = `<div class="bell-empty">Пока нет уведомлений</div>`;
      return;
    }
    list.innerHTML = data.map(n => {
      const dt = n.created_at ? new Date(n.created_at).toLocaleString('ru-RU', { day:'2-digit', month:'short', hour:'2-digit', minute:'2-digit' }) : '';
      const unreadCls = n.is_read ? '' : ' unread';
      const body = n.body ? `<div class="bell-item-body">${escapeHtml(n.body)}</div>` : '';
      const linkAttr = n.link ? ` data-link="${escapeHtml(n.link)}"` : '';
      return `<div class="bell-item${unreadCls}" data-id="${n.id}"${linkAttr}>
        <div class="bell-item-title">${escapeHtml(n.title)}</div>
        ${body}
        <div class="bell-item-time">${dt}</div>
      </div>`;
    }).join('');
    list.querySelectorAll('.bell-item').forEach(el => {
      el.addEventListener('click', async () => {
        const id = el.dataset.id;
        const link = el.dataset.link;
        await sb.from('notifications').update({ is_read: true }).eq('id', id);
        if (link) location.href = link;
        else refreshBell();
      });
    });
  }

  function toggleBellDropdown(e) {
    e.stopPropagation();
    const dd = document.getElementById('bell-dropdown');
    if (!dd) return;
    const willOpen = dd.classList.contains('hidden');
    dd.classList.toggle('hidden');
    if (willOpen) refreshBell();
  }

  function closeBellDropdown() {
    document.getElementById('bell-dropdown')?.classList.add('hidden');
  }

  async function markAllRead(e) {
    e.stopPropagation();
    if (!currentUserId) return;
    await sb.from('notifications').update({ is_read: true })
      .eq('user_id', currentUserId).eq('is_read', false);
    refreshBell();
  }

  function startBellPolling(userId) {
    currentUserId = userId;
    if (!ensureBell()) return; // нет места в шапке — пропускаем (например stats.html)
    refreshBell();
    if (bellPollTimer) clearInterval(bellPollTimer);
    // Опрос каждые 60 сек — недорого, real-time не критичен.
    bellPollTimer = setInterval(refreshBell, 60_000);
  }

  function pageOfCurrent() {
    const path = location.pathname.split('/').pop().toLowerCase();
    return path || 'hub.html';
  }

  function renderRoleSwitcher(roles) {
    const nav = document.getElementById('role-switcher');
    if (!nav) return;
    if (!roles || roles.length < 2) return; // меню имеет смысл с 2+ ролями
    const cur = pageOfCurrent();
    const items = CABINETS
      .filter(c => roles.includes(c.role))
      .map(c => {
        const active = c.page === cur ? ' active' : '';
        return `<a href="${c.page}" class="role-item${active}" data-role="${c.role}">${c.label}</a>`;
      });
    if (!items.length) return;
    nav.innerHTML = `
      <button type="button" class="role-trigger" id="role-trigger" aria-haspopup="true" aria-expanded="false">
        <span class="emoji">👤</span>
        <span>Выбор роли</span>
        <span class="arrow">▾</span>
      </button>
      <div class="role-menu hidden" id="role-menu" role="menu">${items.join('')}</div>`;
    nav.hidden = false;

    // Переход в кабинет оператора требует синтеза legacy operator_session
    // (index.html синхронным гардом проверяет localStorage). Без этого
    // юзер с несколькими ролями уезжает по цепочке index → login → hub.
    nav.querySelectorAll('a.role-item[data-role="operator"]').forEach(a => {
      a.addEventListener('click', async (e) => {
        e.preventDefault();
        const row = await hubRouting.getCurrentUserRow();
        hubRouting.syncLegacyOperatorSession(row);
        location.href = a.getAttribute('href');
      });
    });

    const trigger = document.getElementById('role-trigger');
    const menu = document.getElementById('role-menu');
    trigger.addEventListener('click', (e) => {
      e.stopPropagation();
      const willOpen = menu.classList.contains('hidden');
      menu.classList.toggle('hidden');
      trigger.setAttribute('aria-expanded', willOpen ? 'true' : 'false');
    });
    document.addEventListener('click', (e) => {
      if (!nav.contains(e.target)) {
        menu.classList.add('hidden');
        trigger.setAttribute('aria-expanded', 'false');
      }
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        menu.classList.add('hidden');
        trigger.setAttribute('aria-expanded', 'false');
      }
    });
  }

  async function init(opts = {}) {
    const { requiredRole, greetingPrefix = 'Здравствуйте' } = opts;

    const row = await hubRouting.getCurrentUserRow();
    if (!row) { location.replace('login.html'); return; }
    if (row.status === 'disabled') {
      await sb.auth.signOut();
      location.replace('login.html');
      return;
    }
    const roles = row.roles || [];
    if (requiredRole && !roles.includes(requiredRole)) {
      // Юзер с другой ролью забрёл сюда — отправляем по его основной роли.
      await hubRouting.redirectByRole();
      return;
    }

    const name = (row.full_name && row.full_name.trim()) ? row.full_name : (row.email || '');
    const greetingEl = document.getElementById('greeting');
    if (greetingEl) greetingEl.textContent = greetingPrefix + ', ' + name;
    const emailEl = document.getElementById('user-email');
    if (emailEl) emailEl.textContent = row.email || '';
    const rolesEl = document.getElementById('roles-list');
    if (rolesEl) rolesEl.textContent = roles.length ? roles.join(', ') : '—';

    renderRoleSwitcher(roles);
    startBellPolling(row.id);

    const logoutBtn = document.getElementById('logout');
    if (logoutBtn) {
      logoutBtn.addEventListener('click', async () => {
        // Логируем выход ДО signOut — иначе RLS не пустит anon-инсерт.
        try { if (window.audit) await window.audit.log({ action: 'logout' }); } catch (_) {}
        // Чистим обе сессии: и Supabase Auth, и legacy operator localStorage.
        try { await sb.auth.signOut(); } catch (_) {}
        if (window.operatorSession) window.operatorSession.clear();
        location.replace('login.html');
      });
    }
  }

  window.cabinetShell = { init, CABINETS, refreshBell, startBellPolling, renderRoleSwitcher };

  // ============================================================
  // Универсальный confirmDialog — заменяет нативный window.confirm().
  // Возвращает Promise<boolean>. Доступен глобально как window.confirmDialog.
  // ============================================================
  function escapeHtmlSafe(s) {
    return String(s ?? '').replace(/[&<>"']/g, c => ({
      '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
    }[c]));
  }

  function confirmDialog({ title, message, okText = 'OK', cancelText = 'Отмена', danger = false } = {}) {
    return new Promise((resolve) => {
      const backdrop = document.createElement('div');
      backdrop.className = 'modal-backdrop';
      backdrop.style.zIndex = '9999';
      backdrop.innerHTML = `
        <div class="modal-window" role="dialog" aria-modal="true">
          ${title ? `<h3 class="modal-title">${escapeHtmlSafe(title)}</h3>` : ''}
          ${message ? `<p class="modal-message">${escapeHtmlSafe(message)}</p>` : ''}
          <div class="modal-actions">
            ${cancelText ? `<button type="button" class="btn" data-act="cancel">${escapeHtmlSafe(cancelText)}</button>` : ''}
            <button type="button" class="btn ${danger ? 'danger' : 'primary'}" data-act="ok">${escapeHtmlSafe(okText)}</button>
          </div>
        </div>`;
      const close = (result) => {
        document.removeEventListener('keydown', onKey);
        backdrop.remove();
        resolve(result);
      };
      const onKey = (e) => {
        if (e.key === 'Escape') close(false);
        else if (e.key === 'Enter') close(true);
      };
      backdrop.addEventListener('click', (e) => {
        if (e.target === backdrop) close(false);
        const act = e.target.dataset?.act;
        if (act === 'ok') close(true);
        else if (act === 'cancel') close(false);
      });
      document.addEventListener('keydown', onKey);
      document.body.appendChild(backdrop);
      backdrop.querySelector('[data-act="ok"]')?.focus();
    });
  }

  window.confirmDialog = confirmDialog;
})();
