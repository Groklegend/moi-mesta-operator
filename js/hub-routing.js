// ============================================================
// Маршрутизация по ролям после входа в Хаб
// ============================================================
// Используется на страницах login.html / invite.html / hub.html.
// Читает public.users по auth.uid(), берёт roles[] и решает куда вести.

(function () {
  async function getCurrentUserRow() {
    const { data: { user } } = await sb.auth.getUser();
    if (!user) return null;
    const { data, error } = await sb
      .from('users')
      .select('id, email, full_name, roles, status')
      .eq('id', user.id)
      .maybeSingle();
    if (error) { console.error('users select:', error); return null; }
    return data;
  }

  // Куда вести по ролям после логина.
  // Если ролей одна — сразу в нужный кабинет.
  // Если 2+ — на hub.html, чтобы юзер выбрал.
  function pickLandingPage(roles, status) {
    if (!roles || roles.length === 0) return null;
    if (status === 'disabled') return null;
    if (roles.length > 1) return 'hub.html';
    const r = roles[0];
    if (r === 'admin')    return 'admin.html';
    if (r === 'operator') return 'index.html';
    if (r === 'seller')   return 'seller.html';
    if (r === 'marketer') return 'marketer.html';
    return 'hub.html';
  }

  async function redirectByRole() {
    const row = await getCurrentUserRow();
    if (!row) {
      // Сессия есть, но строки в public.users нет — выкидываем и ругаемся.
      await sb.auth.signOut();
      alert('Учётка не найдена в Хабе. Обратитесь к администратору.');
      return;
    }
    if (row.status === 'disabled') {
      await sb.auth.signOut();
      alert('Учётка отключена. Обратитесь к администратору.');
      return;
    }
    const target = pickLandingPage(row.roles, row.status);
    if (!target) {
      await sb.auth.signOut();
      alert('У вас нет ролей в Хабе. Обратитесь к администратору.');
      return;
    }
    // Совместимость с index.html: он ждёт operatorSession в localStorage.
    // Когда оператор входит через Supabase Auth (login.html), синтезируем
    // эту сессию из public.users — это позволяет старому экрану оператора
    // работать без переделки до полной миграции в PR-следующих этапов.
    // public.users.id = operators.id (мы их сделали равными при миграции),
    // так что motivation_entries и stats остаются привязаны корректно.
    if (target === 'index.html' && typeof window.operatorSession !== 'undefined') {
      window.operatorSession.set({
        id: row.id,
        name: (row.full_name && row.full_name.trim()) || row.email,
        login: '__supabase__',
      }, true);
    }
    location.replace(target);
  }

  window.hubRouting = {
    getCurrentUserRow,
    pickLandingPage,
    redirectByRole,
  };
})();
