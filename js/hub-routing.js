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
    if (r === 'admin')      return 'admin.html';
    if (r === 'operator')   return 'index.html';
    if (r === 'seller')     return 'seller.html';
    if (r === 'marketer')   return 'marketer.html';
    if (r === 'commercial') return 'commercial.html';
    return 'hub.html';
  }

  // Совместимость с index.html: он ждёт operatorSession в localStorage.
  // Синтезируем эту сессию из public.users, чтобы старый экран оператора
  // работал без переделки. public.users.id = operators.id (выровняли при
  // миграции), значит motivation_entries и stats остаются привязаны.
  // Используется и при логине (redirectByRole), и при клике на «Оператор»
  // в hub.html / role-switcher (когда у юзера несколько ролей).
  function syncLegacyOperatorSession(row) {
    if (!row || typeof window.operatorSession === 'undefined') return;
    if (!Array.isArray(row.roles) || !row.roles.includes('operator')) return;
    window.operatorSession.set({
      id: row.id,
      name: (row.full_name && row.full_name.trim()) || row.email,
      login: '__supabase__',
    }, true);
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
    if (target === 'index.html') syncLegacyOperatorSession(row);
    location.replace(target);
  }

  window.hubRouting = {
    getCurrentUserRow,
    pickLandingPage,
    redirectByRole,
    syncLegacyOperatorSession,
  };
})();
