// ============================================================
// Сессия оператора — хранение в localStorage/sessionStorage, редиректы
// ============================================================
// localStorage — «запомнить меня» (живёт вечно, пока оператор сам не выйдет).
// sessionStorage — разовый вход (исчезнет при закрытии вкладки/браузера).
(function () {
  const KEY = 'operator_session';

  function read() {
    const raw = localStorage.getItem(KEY) || sessionStorage.getItem(KEY);
    if (!raw) return null;
    try {
      const s = JSON.parse(raw);
      return s && s.id && s.name ? s : null;
    } catch { return null; }
  }

  window.operatorSession = {
    get() { return read(); },
    set(sess, remember = true) {
      const raw = JSON.stringify(sess);
      // всегда чистим оба стора, чтобы не было двух сессий сразу
      localStorage.removeItem(KEY);
      sessionStorage.removeItem(KEY);
      (remember ? localStorage : sessionStorage).setItem(KEY, raw);
    },
    clear() {
      localStorage.removeItem(KEY);
      sessionStorage.removeItem(KEY);
    },
    require() {
      if (!read()) { location.replace('operator-login.html'); return false; }
      return true;
    },
    logout() {
      this.clear();
      location.replace('operator-login.html');
    },
  };
})();
