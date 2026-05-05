// ============================================================
// Запись событий в public.audit_log с клиента (ТЗ §7.1).
// ============================================================
// Не блокирует UX: ошибки записи только в console.warn.
//
// RLS на audit_log:
//   • authenticated: может писать про себя (user_id is null OR = auth.uid())
//   • anon: только action='login_failed'.
// Поэтому неудачный вход на login.html логируется ПЕРЕД авторизацией
// как anon-запись с user_id=null и метаданными о попытке.

(function () {
  async function auditLog(event) {
    try {
      // Если есть Supabase-сессия — подставим user_id/email автоматом.
      let user_id = null;
      let user_email = event.user_email || null;
      try {
        const { data } = await sb.auth.getUser();
        if (data?.user) {
          user_id = data.user.id;
          if (!user_email) user_email = data.user.email || null;
        }
      } catch (_) { /* без сессии — пишем как anon */ }

      const row = {
        user_id,
        user_email,
        is_agent: false,
        action: event.action,
        target_type: event.target_type || null,
        target_id: event.target_id || null,
        user_agent: navigator.userAgent || null,
        metadata: event.metadata || null,
      };
      const { error } = await sb.from('audit_log').insert(row);
      if (error) console.warn('[audit]', event.action, error.message);
    } catch (e) {
      console.warn('[audit]', e);
    }
  }

  // Удобные обёртки для частых CRUD-событий в админке.
  window.audit = {
    log: auditLog,
    save: (table, isNew, id, payload) =>
      auditLog({
        action: `${table}_${isNew ? 'create' : 'update'}`,
        target_type: table,
        target_id: id || null,
        metadata: payload || null,
      }),
    del: (table, id, label) =>
      auditLog({
        action: `${table}_delete`,
        target_type: table,
        target_id: id || null,
        metadata: label ? { label } : null,
      }),
  };
})();
