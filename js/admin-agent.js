// ============================================================
// admin-agent.js — раздел «Настройки Гари» + «Сообщения от Гари»
// ============================================================
// Работает только на admin.html. Использует уже инициализированный sb
// (Supabase client) и общий обработчик переключения вкладок из admin.js
// (события клика по .admin-nav).
//
// Разделы:
//   1. Расписание процессов (agent_processes)
//   2. Бюджет и темы (agent_settings.monthly_ai_budget_rub, agent_topics)
//   3. URL вебхуков (agent_settings.webhook_*)
//   4. Сервисные токены (service_tokens) — генерация в браузере, в БД только хеш
//   5. Сообщения от Гари (agent_messages)

(function () {
  if (!document.getElementById('tab-agent')) return;

  // ---------- Утилиты ----------

  function $(sel, root = document) { return root.querySelector(sel); }
  function $$(sel, root = document) { return Array.from(root.querySelectorAll(sel)); }

  function toast(msg, kind) {
    const t = $('#toast');
    if (!t) return;
    t.textContent = msg;
    t.classList.remove('hidden');
    t.style.background = kind === 'error' ? 'var(--danger)' : '';
    clearTimeout(toast._t);
    toast._t = setTimeout(() => t.classList.add('hidden'), 1800);
  }

  function fmtDate(s) {
    if (!s) return '—';
    return new Date(s).toLocaleString('ru-RU', {
      day:'2-digit', month:'short', hour:'2-digit', minute:'2-digit',
    });
  }

  // ---------- Подвкладки внутри «Настройки Гари» ----------

  function bindSubnav() {
    $$('#agent-subnav .agent-subtab').forEach(btn => {
      btn.addEventListener('click', () => {
        $$('#agent-subnav .agent-subtab').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        $$('#tab-agent .agent-pane').forEach(p => {
          p.classList.toggle('hidden', p.dataset.sub !== btn.dataset.sub);
        });
        // Лениво подгружаем содержимое выбранной подвкладки.
        switch (btn.dataset.sub) {
          case 'schedule': loadProcesses(); break;
          case 'budget':   loadBudget(); loadTopics(); break;
          case 'webhooks': loadWebhooks(); break;
          case 'tokens':   loadTokens(); break;
        }
      });
    });
  }

  // ---------- 1. Процессы ----------

  async function loadProcesses() {
    const tbody = $('#agent-proc-table tbody');
    tbody.innerHTML = `<tr><td colspan="6" class="empty">Загрузка…</td></tr>`;
    const { data, error } = await sb.from('agent_processes')
      .select('*').order('sort_order', { ascending: true });
    if (error) {
      tbody.innerHTML = `<tr><td colspan="6" class="empty">Ошибка: ${escapeHtml(error.message)}</td></tr>`;
      return;
    }
    if (!data || !data.length) {
      tbody.innerHTML = `<tr><td colspan="6" class="empty">Процессы не настроены</td></tr>`;
      return;
    }
    tbody.innerHTML = data.map(p => `
      <tr data-id="${p.id}">
        <td><b>${escapeHtml(p.label)}</b><div class="muted" style="font-size:12px;">${escapeHtml(p.slug)}</div></td>
        <td style="font-size:13px;color:var(--ink-2);max-width:260px;">${escapeHtml(p.description || '')}</td>
        <td><input type="text" class="cron-input" data-id="${p.id}" value="${escapeHtml(p.schedule_cron || '')}" placeholder="0 6 * * *" style="width:140px;font-family:ui-monospace,monospace;font-size:13px;"></td>
        <td>
          <label class="toggle">
            <input type="checkbox" class="toggle-input" data-id="${p.id}" ${p.enabled ? 'checked' : ''}>
            <span class="tgl-track"><span class="tgl-thumb"></span></span>
          </label>
        </td>
        <td style="font-size:12px;">
          ${p.last_run_at ? fmtDate(p.last_run_at) : '<span class="muted">— не было —</span>'}
          ${p.last_status ? `<div><span class="badge ${p.last_status === 'ok' ? 'success' : 'off'}">${escapeHtml(p.last_status)}</span></div>` : ''}
        </td>
        <td><button class="btn sm save-row" data-id="${p.id}">Сохранить</button></td>
      </tr>`).join('');

    tbody.querySelectorAll('.save-row').forEach(btn => {
      btn.addEventListener('click', async () => {
        const id = btn.dataset.id;
        const cron = tbody.querySelector(`.cron-input[data-id="${id}"]`).value.trim();
        const enabled = tbody.querySelector(`.toggle-input[data-id="${id}"]`).checked;
        btn.disabled = true; btn.textContent = '…';
        const { error } = await sb.from('agent_processes')
          .update({ schedule_cron: cron, enabled }).eq('id', id);
        btn.disabled = false; btn.textContent = 'Сохранить';
        if (error) { toast(error.message, 'error'); return; }
        toast('Сохранено');
        if (window.audit) audit.log({
          action: 'agent_process_update', target_type: 'agent_processes',
          target_id: id, metadata: { schedule_cron: cron, enabled },
        });
      });
    });
  }

  // ---------- 2. Бюджет ----------

  async function loadBudget() {
    const { data, error } = await sb.from('agent_settings')
      .select('value').eq('key', 'monthly_ai_budget_rub').maybeSingle();
    if (error) { console.warn(error); return; }
    const inp = $('#agent-budget');
    if (inp) inp.value = (data?.value ?? '') === '' ? '' : Number(data?.value || 0);
  }

  async function saveBudget() {
    const v = Math.max(0, Number($('#agent-budget').value) || 0);
    const btn = $('#agent-budget-save');
    btn.disabled = true; btn.textContent = '…';
    const { error } = await sb.from('agent_settings')
      .upsert({ key: 'monthly_ai_budget_rub', value: v }, { onConflict: 'key' });
    btn.disabled = false; btn.textContent = 'Сохранить';
    if (error) { toast(error.message, 'error'); return; }
    toast('Бюджет сохранён');
    if (window.audit) audit.log({
      action: 'agent_budget_update', target_type: 'agent_settings',
      metadata: { monthly_ai_budget_rub: v },
    });
  }

  // ---------- 2b. Темы ----------

  async function loadTopics() {
    const list = $('#agent-topics-list');
    if (!list) return;
    list.innerHTML = `<div class="muted" style="font-size:13px;">Загрузка…</div>`;
    const { data, error } = await sb.from('agent_topics')
      .select('id, topic').order('topic');
    if (error) { list.innerHTML = `<div class="muted">Ошибка: ${escapeHtml(error.message)}</div>`; return; }
    if (!data || !data.length) {
      list.innerHTML = `<div class="muted" style="font-size:13px;">Тем пока нет.</div>`;
      return;
    }
    list.innerHTML = data.map(t => `
      <span class="topic-chip" data-id="${t.id}">
        ${escapeHtml(t.topic)}
        <button class="topic-del" data-id="${t.id}" title="Удалить">×</button>
      </span>`).join('');
    list.querySelectorAll('.topic-del').forEach(btn => {
      btn.addEventListener('click', async () => {
        const id = btn.dataset.id;
        const { error } = await sb.from('agent_topics').delete().eq('id', id);
        if (error) { toast(error.message, 'error'); return; }
        if (window.audit) audit.del('agent_topics', id);
        loadTopics();
      });
    });
  }

  async function addTopic() {
    const inp = $('#agent-topic-new');
    const topic = (inp.value || '').trim();
    if (!topic) return;
    const { error } = await sb.from('agent_topics').insert({ topic });
    if (error) { toast(error.message, 'error'); return; }
    inp.value = '';
    if (window.audit) audit.log({ action: 'agent_topics_create', target_type: 'agent_topics', metadata: { topic } });
    loadTopics();
  }

  // ---------- 3. URL вебхуков ----------

  const WH_KEYS = [
    ['webhook_new_application',    'wh-new-application'],
    ['webhook_marketing_decision', 'wh-marketing-decision'],
    ['webhook_settings_changed',   'wh-settings-changed'],
  ];

  async function loadWebhooks() {
    const keys = WH_KEYS.map(([k]) => k);
    const { data, error } = await sb.from('agent_settings')
      .select('key, value').in('key', keys);
    if (error) { toast(error.message, 'error'); return; }
    const byKey = Object.fromEntries((data || []).map(r => [r.key, r.value]));
    for (const [key, inputId] of WH_KEYS) {
      const inp = document.getElementById(inputId);
      if (inp) inp.value = byKey[key] || '';
    }
  }

  async function saveWebhooks() {
    const rows = WH_KEYS.map(([key, inputId]) => ({
      key, value: (document.getElementById(inputId).value || '').trim(),
    }));
    const btn = $('#agent-webhooks-save');
    btn.disabled = true; btn.textContent = '…';
    const { error } = await sb.from('agent_settings')
      .upsert(rows, { onConflict: 'key' });
    btn.disabled = false; btn.textContent = 'Сохранить';
    if (error) { toast(error.message, 'error'); return; }
    toast('Вебхуки сохранены');
    if (window.audit) audit.log({
      action: 'agent_webhooks_update', target_type: 'agent_settings',
      metadata: Object.fromEntries(rows.map(r => [r.key, r.value])),
    });
  }

  // ---------- 4. Сервисные токены ----------

  async function loadTokens() {
    const tbody = $('#agent-token-table tbody');
    tbody.innerHTML = `<tr><td colspan="6" class="empty">Загрузка…</td></tr>`;
    const { data, error } = await sb.from('service_tokens')
      .select('*').order('created_at', { ascending: false });
    if (error) {
      tbody.innerHTML = `<tr><td colspan="6" class="empty">Ошибка: ${escapeHtml(error.message)}</td></tr>`;
      return;
    }
    if (!data || !data.length) {
      tbody.innerHTML = `<tr><td colspan="6" class="empty">Токенов нет. Создайте первый.</td></tr>`;
      return;
    }
    tbody.innerHTML = data.map(t => {
      const revoked = !!t.revoked_at;
      return `
        <tr data-id="${t.id}">
          <td><b>${escapeHtml(t.name || '—')}</b></td>
          <td><code style="font-size:13px;">${escapeHtml(t.token_prefix || '')}…</code></td>
          <td style="font-size:13px;">${fmtDate(t.created_at)}</td>
          <td style="font-size:13px;">${t.last_used_at ? fmtDate(t.last_used_at) : '<span class="muted">— не было —</span>'}</td>
          <td>${revoked
            ? `<span class="badge off">Отозван ${fmtDate(t.revoked_at)}</span>`
            : `<span class="badge success">Активен</span>`}</td>
          <td>${revoked ? '' : `<button class="btn danger sm token-revoke" data-id="${t.id}">Отозвать</button>`}</td>
        </tr>`;
    }).join('');
    tbody.querySelectorAll('.token-revoke').forEach(btn => {
      btn.addEventListener('click', async () => {
        if (!confirm('Отозвать токен? После этого Гари с ним больше не сможет ходить в API.')) return;
        const id = btn.dataset.id;
        const { error } = await sb.from('service_tokens')
          .update({ revoked_at: new Date().toISOString() }).eq('id', id);
        if (error) { toast(error.message, 'error'); return; }
        if (window.audit) audit.log({
          action: 'service_token_revoke', target_type: 'service_tokens', target_id: id,
        });
        toast('Токен отозван');
        loadTokens();
      });
    });
  }

  async function createToken() {
    const name = (prompt('Имя токена (для напоминания, кому выдан):', 'Гари — офис') || '').trim();
    if (!name) return;

    // Генерим случайный токен 32 байта в hex (~64 символа), считаем SHA-256.
    const bytes = new Uint8Array(32);
    crypto.getRandomValues(bytes);
    const plain = 'hub_' + [...bytes].map(b => b.toString(16).padStart(2, '0')).join('');
    const hashBuf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(plain));
    const hashHex = [...new Uint8Array(hashBuf)].map(b => b.toString(16).padStart(2, '0')).join('');
    const prefix = plain.slice(0, 12);

    const { data: { user } } = await sb.auth.getUser();
    const { data, error } = await sb.from('service_tokens').insert({
      name, token_hash: hashHex, token_prefix: prefix,
      created_by: user?.id || null,
    }).select().single();
    if (error) { toast(error.message, 'error'); return; }
    if (window.audit) audit.log({
      action: 'service_token_create', target_type: 'service_tokens',
      target_id: data.id, metadata: { name, prefix },
    });

    showTokenOnce(plain, name);
    loadTokens();
  }

  function showTokenOnce(plain, name) {
    // Простая модалка: используем уже существующую #modal из admin.html.
    const modal = document.getElementById('modal');
    const title = document.getElementById('modal-title');
    const body = document.getElementById('modal-body');
    if (!modal || !body) {
      // Фоллбек: обычный prompt с возможностью копирования.
      window.prompt('Скопируйте токен (показывается ОДИН раз):', plain);
      return;
    }
    title.textContent = `Новый токен «${name}»`;
    body.innerHTML = `
      <p style="margin-top:0;">
        Сохраните токен сейчас — он показывается <b>один раз</b> и больше нигде в системе не хранится
        (в БД лежит только sha256-хеш).
      </p>
      <pre style="background:var(--bg-soft);padding:14px 16px;border-radius:10px;overflow-x:auto;font-size:13px;user-select:all;">${escapeHtml(plain)}</pre>
      <div class="actions" style="margin-top:16px;">
        <button class="btn primary" id="copy-token">📋 Скопировать в буфер</button>
        <button class="btn" id="close-token">Закрыть</button>
      </div>
      <p style="color:var(--muted);font-size:12px;margin-top:14px;">
        Передайте токен в офис Гари как переменную окружения <code>HUB_SERVICE_TOKEN</code>.
        В заголовке запросов: <code>Authorization: Bearer &lt;токен&gt;</code>.
      </p>`;
    modal.classList.remove('hidden');
    body.querySelector('#copy-token').addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(plain);
        toast('Скопировано');
      } catch (e) {
        toast('Не удалось скопировать — выделите вручную', 'error');
      }
    });
    body.querySelector('#close-token').addEventListener('click', () => {
      modal.classList.add('hidden');
    });
  }

  // ---------- 5. Сообщения от Гари ----------

  async function loadAgentMessages() {
    const list = $('#agent-messages-list');
    if (!list) return;
    list.innerHTML = `<div class="empty plain">Загрузка…</div>`;
    let q = sb.from('agent_messages')
      .select('*').order('created_at', { ascending: false }).limit(200);
    if ($('#agent-msg-unread')?.checked) q = q.eq('is_read', false);
    const { data, error } = await q;
    if (error) { list.innerHTML = `<div class="empty">Ошибка: ${escapeHtml(error.message)}</div>`; return; }
    if (!data || !data.length) {
      list.innerHTML = `<div class="empty plain">Сообщений нет.</div>`;
      return;
    }
    list.innerHTML = data.map(m => {
      const lvlCls = {
        info: 'info', success: 'success', warning: 'warning', error: 'error',
      }[m.level] || 'info';
      const lvlLabel = {
        info: 'Инфо', success: 'Успех', warning: 'Внимание', error: 'Ошибка',
      }[m.level] || m.level;
      return `
        <div class="agent-msg level-${lvlCls} ${m.is_read ? '' : 'unread'}" data-id="${m.id}">
          <div class="agent-msg-head">
            <span class="agent-msg-level">${escapeHtml(lvlLabel)}</span>
            <span class="agent-msg-time">${fmtDate(m.created_at)}</span>
            ${m.is_read ? '' : '<button class="btn sm" data-mark="${m.id}">Прочитать</button>'.replace('${m.id}', m.id)}
          </div>
          <div class="agent-msg-title">${escapeHtml(m.title)}</div>
          ${m.body ? `<div class="agent-msg-body">${escapeHtml(m.body)}</div>` : ''}
          ${m.metadata ? `<details class="agent-msg-meta"><summary>metadata</summary><pre>${escapeHtml(JSON.stringify(m.metadata, null, 2))}</pre></details>` : ''}
        </div>`;
    }).join('');
    list.querySelectorAll('[data-mark]').forEach(btn => {
      btn.addEventListener('click', async () => {
        await sb.from('agent_messages').update({ is_read: true }).eq('id', btn.dataset.mark);
        loadAgentMessages();
      });
    });
  }

  async function markAllAgentMessages() {
    const { error } = await sb.from('agent_messages').update({ is_read: true }).eq('is_read', false);
    if (error) { toast(error.message, 'error'); return; }
    toast('Все отмечены прочитанными');
    loadAgentMessages();
  }

  // ---------- Привязка action-обработчиков ----------

  function wireActions() {
    bindSubnav();
    $('#agent-budget-save')?.addEventListener('click', saveBudget);
    $('#agent-topic-add')?.addEventListener('click', addTopic);
    $('#agent-topic-new')?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); addTopic(); }
    });
    $('#agent-webhooks-save')?.addEventListener('click', saveWebhooks);
    $('#agent-token-create')?.addEventListener('click', createToken);
    $('#agent-msg-refresh')?.addEventListener('click', loadAgentMessages);
    $('#agent-msg-mark-all')?.addEventListener('click', markAllAgentMessages);
    $('#agent-msg-unread')?.addEventListener('change', loadAgentMessages);

    // Хук на навигацию админки: когда user кликает «Настройки Гари»
    // или «Сообщения от Гари» — лениво подгружаем содержимое.
    document.querySelectorAll('.admin-nav a[data-tab]').forEach(a => {
      a.addEventListener('click', () => {
        const t = a.dataset.tab;
        if (t === 'agent') {
          // Активная подвкладка — schedule по умолчанию.
          loadProcesses();
        } else if (t === 'agent-messages') {
          loadAgentMessages();
        }
      });
    });

    // Если зашли по hash сразу на одну из агентских вкладок — подгружаем.
    const h = location.hash.replace('#', '');
    if (h === 'agent') loadProcesses();
    if (h === 'agent-messages') loadAgentMessages();
  }

  wireActions();
})();
