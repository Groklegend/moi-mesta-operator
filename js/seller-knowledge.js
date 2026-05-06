// ============================================================
// База знаний для менеджера: Рубрики, Возражения, Документы
// Только просмотр. Источник — таблицы categories/objections/documents
// с audience='seller'. Управление — у коммерческого директора.
// ============================================================

(function () {
  if (!document.getElementById('section-kb-categories')) return;

  const AUDIENCE = 'seller';
  const state = { cats: [], objs: [], docs: [], objSearch: '', loaded: { cats: false, objs: false, docs: false } };

  function $(s, r = document) { return r.querySelector(s); }
  function esc(s) {
    return String(s ?? '').replace(/[&<>"']/g, c => ({
      '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
    }[c]));
  }
  // Безопасно показываем HTML-описание (Quill сохраняет HTML).
  function safeHtml(html) {
    if (!html) return '';
    if (window.DOMPurify) return DOMPurify.sanitize(html);
    return esc(html);
  }

  // ---------- Рубрики ----------
  async function loadCats() {
    const tb = $('#kb-cat-table tbody');
    if (!tb) return;
    const [catsRes, objsRes] = await Promise.all([
      sb.from('categories').select('*').eq('audience', AUDIENCE).order('sort_order'),
      sb.from('objections').select('id, category_id').eq('audience', AUDIENCE).eq('is_active', true),
    ]);
    if (catsRes.error) { tb.innerHTML = `<tr><td colspan="3" class="empty">Ошибка: ${esc(catsRes.error.message)}</td></tr>`; return; }
    state.cats = catsRes.data || [];
    const counts = {};
    for (const o of (objsRes.data || [])) counts[o.category_id] = (counts[o.category_id] || 0) + 1;
    if (!state.cats.length) {
      tb.innerHTML = '<tr><td colspan="3" class="empty">Рубрики пока не добавлены</td></tr>';
      return;
    }
    tb.innerHTML = state.cats.map(c => `
      <tr>
        <td style="font-size:22px;width:60px;">${esc(c.icon || '📁')}</td>
        <td><strong>${esc(c.name)}</strong></td>
        <td>${counts[c.id] || 0}</td>
      </tr>`).join('');
    state.loaded.cats = true;
  }

  // ---------- Возражения ----------
  async function loadObjs() {
    const list = $('#kb-obj-list');
    if (!list) return;
    if (!state.loaded.cats) await loadCats();
    const { data, error } = await sb.from('objections').select('*')
      .eq('audience', AUDIENCE).eq('is_active', true).order('sort_order');
    if (error) { list.innerHTML = `<div class="empty">Ошибка: ${esc(error.message)}</div>`; return; }
    state.objs = data || [];
    state.loaded.objs = true;
    renderObjs();
  }

  function renderObjs() {
    const list = $('#kb-obj-list');
    if (!list) return;
    const catsById = Object.fromEntries(state.cats.map(c => [c.id, c]));
    const q = state.objSearch.trim().toLowerCase();
    let items = state.objs;
    if (q) {
      items = items.filter(o =>
        (o.title || '').toLowerCase().includes(q) ||
        (o.keywords || '').toLowerCase().includes(q) ||
        (o.answer || '').toLowerCase().includes(q));
    }
    if (!items.length) {
      list.innerHTML = `<div class="empty plain">${q ? 'Ничего не найдено' : 'Возражения пока не добавлены'}</div>`;
      return;
    }
    list.innerHTML = items.map(o => {
      const cat = catsById[o.category_id];
      const catBadge = o.is_general
        ? '<span class="kb-cat-badge">Общее</span>'
        : (cat ? `<span class="kb-cat-badge">${esc(cat.icon || '')} ${esc(cat.name)}</span>` : '');
      return `
        <details class="kb-obj-item">
          <summary>
            <span class="kb-obj-title">${esc(o.title)}</span>
            ${catBadge}
          </summary>
          <div class="kb-obj-body">
            <div class="kb-obj-answer">${safeHtml(o.answer)}</div>
            ${o.details ? `<div class="kb-obj-details">${safeHtml(o.details)}</div>` : ''}
          </div>
        </details>`;
    }).join('');
  }

  $('#kb-obj-search')?.addEventListener('input', (e) => {
    state.objSearch = e.target.value || '';
    renderObjs();
  });

  // ---------- Документы (оператор-стиль: список слева, детали справа) ----------
  async function loadDocs() {
    const list = $('#kb-doc-list');
    const pane = $('#kb-doc-pane');
    if (!list) return;
    const { data, error } = await sb.from('documents').select('*')
      .eq('audience', AUDIENCE).order('sort_order');
    if (error) { list.innerHTML = `<div class="empty">Ошибка: ${esc(error.message)}</div>`; return; }
    state.docs = data || [];
    state.loaded.docs = true;
    if (!state.docs.length) {
      list.innerHTML = '<div class="empty plain" style="font-size:13px;padding:24px 12px;color:var(--muted);">Документов пока нет</div>';
      if (pane) pane.innerHTML = `
        <div class="placeholder">
          <span class="big-icon">📎</span>
          Документы пока не добавлены
        </div>`;
      return;
    }
    list.innerHTML = state.docs.map(d => `
      <button class="kb-doc-item" type="button" data-doc-id="${esc(d.id)}">${esc(d.name)}</button>
    `).join('');
    list.querySelectorAll('.kb-doc-item').forEach(btn => {
      btn.addEventListener('click', () => openDoc(btn.dataset.docId));
    });
  }

  function openDoc(id) {
    const d = state.docs.find(x => x.id === id);
    const pane = $('#kb-doc-pane');
    if (!d || !pane) return;
    document.querySelectorAll('#kb-doc-list .kb-doc-item').forEach(b => {
      b.classList.toggle('active', b.dataset.docId === id);
    });
    const descr = (d.description || '').trim();
    pane.innerHTML = `
      <h1 class="kb-doc-title">${esc(d.name)}</h1>
      <div class="kb-doc-descr">${descr ? esc(descr) : '<span style="color:var(--muted);">Описание не добавлено</span>'}</div>
      <div class="kb-doc-actions">
        <button class="btn primary" id="kb-doc-open" type="button">📎 Открыть документ</button>
        <button class="btn" id="kb-doc-copy" type="button">📋 Скопировать ссылку</button>
      </div>
      <div class="kb-doc-url-line">${esc(d.url)}</div>`;
    pane.querySelector('#kb-doc-open').addEventListener('click', () => {
      window.open(d.url, '_blank', 'noopener');
    });
    pane.querySelector('#kb-doc-copy').addEventListener('click', async () => {
      try { await navigator.clipboard.writeText(d.url); toast('Ссылка скопирована'); }
      catch { toast('Не удалось скопировать', 'error'); }
    });
  }

  function toast(msg) {
    const t = document.getElementById('toast');
    if (!t) return;
    t.textContent = msg;
    t.classList.remove('hidden');
    clearTimeout(toast._t);
    toast._t = setTimeout(() => t.classList.add('hidden'), 1800);
  }

  // Лениво подгружаем при клике на соответствующую вкладку.
  document.querySelectorAll('#seller-nav .seller-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      const sec = btn.dataset.section;
      if (sec === 'kb-categories') loadCats();
      else if (sec === 'kb-objections') loadObjs();
      else if (sec === 'kb-documents') loadDocs();
    });
  });

  // Если страница загрузилась прямо на одной из этих вкладок (по hash) —
  // подгрузим данные при старте.
  const initial = (location.hash || '').replace('#', '');
  if (initial === 'kb-categories') loadCats();
  else if (initial === 'kb-objections') loadObjs();
  else if (initial === 'kb-documents') loadDocs();
})();
