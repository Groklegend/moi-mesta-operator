// ============================================================
// Сессия оператора — хранение в localStorage, редиректы
// ============================================================
(function () {
  const KEY = 'operator_session';

  window.operatorSession = {
    get() {
      try {
        const raw = localStorage.getItem(KEY);
        if (!raw) return null;
        const s = JSON.parse(raw);
        return s && s.id && s.name ? s : null;
      } catch { return null; }
    },
    set(sess) { localStorage.setItem(KEY, JSON.stringify(sess)); },
    clear() { localStorage.removeItem(KEY); },
    require() {
      if (!this.get()) { location.replace('operator-login.html'); return false; }
      return true;
    },
    logout() {
      this.clear();
      location.replace('operator-login.html');
    },
  };
})();
