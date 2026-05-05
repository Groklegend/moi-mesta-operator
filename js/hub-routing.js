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

  // Куда вести по ролям. Пока кабинеты продажника/маркетолога не реализованы —
  // их и админа ведём на admin.html, оператора — на index.html.
  // В PR-3 появится /hub.html с переключателем ролей.
  function pickLandingPage(roles, status) {
    if (!roles || roles.length === 0) return null; // нет ролей — нет доступа
    if (status === 'disabled') return null;
    if (roles.includes('admin')) return 'admin.html';
    // Продажник/маркетолог пока без кабинета — заглушка через hub.html (появится в PR-3).
    // Оператор по этой ветке не пойдёт: он входит через operator-login.html.
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
    location.replace(target);
  }

  window.hubRouting = {
    getCurrentUserRow,
    pickLandingPage,
    redirectByRole,
  };
})();
