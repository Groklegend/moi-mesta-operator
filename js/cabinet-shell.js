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
    { role: 'operator', label: 'Оператор',   page: 'index.html'   },
    { role: 'seller',   label: 'Продажник',  page: 'seller.html'  },
    { role: 'marketer', label: 'Маркетолог', page: 'marketer.html'},
    { role: 'admin',    label: 'Админка',    page: 'admin.html'   },
  ];

  function pageOfCurrent() {
    const path = location.pathname.split('/').pop().toLowerCase();
    return path || 'hub.html';
  }

  function renderRoleSwitcher(roles) {
    const nav = document.getElementById('role-switcher');
    if (!nav) return;
    if (!roles || roles.length < 2) return; // переключатель имеет смысл с 2+ ролями
    const cur = pageOfCurrent();
    const buttons = CABINETS
      .filter(c => roles.includes(c.role))
      .map(c => {
        const active = c.page === cur ? ' active' : '';
        return `<a href="${c.page}" class="role-btn${active}">${c.label}</a>`;
      });
    if (!buttons.length) return;
    nav.innerHTML = buttons.join('');
    nav.hidden = false;
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

    const logoutBtn = document.getElementById('logout');
    if (logoutBtn) {
      logoutBtn.addEventListener('click', async () => {
        // Чистим обе сессии: и Supabase Auth, и legacy operator localStorage.
        try { await sb.auth.signOut(); } catch (_) {}
        if (window.operatorSession) window.operatorSession.clear();
        location.replace('login.html');
      });
    }
  }

  window.cabinetShell = { init, CABINETS };
})();
