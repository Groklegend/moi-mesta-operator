// ============================================================
// База знаний для менеджера: Рубрики, Возражения, Документы
// Только просмотр. Источник — таблицы categories/objections/documents
// с audience='seller'. Управление — у коммерческого директора.
// ============================================================

(function () {
  if (!document.getElementById('section-kb-categories')) return;

  const AUDIENCE = 'seller';
  const state = {
    cats: [], objs: [], docs: [],
    objSearch: '',
    objActiveCatId: null,   // id выбранной рубрики для секции «Специфичные» (null = все)
    objCurrent: null,       // открытое сейчас возражение
    objView: 'answer',      // 'answer' | 'details'
    loaded: { cats: false, objs: false, docs: false },
    objBoundUI: false,      // одноразовая привязка обработчиков поиска и дропдауна
  };

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

  // ---------- Возражения (2-колоночный режим как у оператора) ----------
  async function loadObjs() {
    if (!$('#kb-obj-pane')) return;
    if (!state.loaded.cats) await loadCats();
    const { data, error } = await sb.from('objections').select('*')
      .eq('audience', AUDIENCE).eq('is_active', true).order('sort_order');
    if (error) {
      $('#kb-obj-pane').innerHTML = `<div class="placeholder"><span class="big-icon">⚠️</span>Ошибка: ${esc(error.message)}</div>`;
      return;
    }
    state.objs = data || [];
    state.loaded.objs = true;
    renderObjCatDropdown();
    renderObjLists();
    bindObjUIOnce();
  }

  // ----- Дропдаун рубрик в шапке секции -----
  function renderObjCatDropdown() {
    const menu = $('#kb-obj-cat-menu');
    if (!menu) return;
    const items = [
      { id: null, name: 'Все рубрики', icon: '🗂️' },
      ...state.cats.map(c => ({ id: c.id, name: c.name, icon: c.icon || '📁' })),
    ];
    menu.innerHTML = items.map(c => `
      <button data-id="${c.id === null ? 'all' : esc(c.id)}" class="${c.id === state.objActiveCatId ? 'active' : ''}">
        <span class="emoji">${esc(c.icon)}</span><span>${esc(c.name)}</span>
      </button>`).join('');
    menu.querySelectorAll('button').forEach(b => {
      b.addEventListener('click', () => {
        state.objActiveCatId = b.dataset.id === 'all' ? null : b.dataset.id;
        // При смене рубрики чистим поиск, чтобы пользователь увидел список
        const search = $('#kb-obj-search');
        if (search && search.value) { search.value = ''; state.objSearch = ''; }
        renderObjCatDropdown();
        updateObjCatTriggerLabel();
        renderObjLists();
        closeObjCatMenu();
      });
    });
    updateObjCatTriggerLabel();
  }

  function updateObjCatTriggerLabel() {
    const label = $('#kb-obj-cat-label');
    const emoji = $('#kb-obj-cat-emoji');
    if (!label || !emoji) return;
    if (state.objActiveCatId === null) {
      label.textContent = 'Все рубрики';
      emoji.textContent = '🗂️';
    } else {
      const c = state.cats.find(x => x.id === state.objActiveCatId);
      label.textContent = c?.name || 'Рубрика';
      emoji.textContent = c?.icon || '📁';
    }
  }

  function closeObjCatMenu() {
    $('#kb-obj-cat-menu')?.classList.add('hidden');
    $('#kb-obj-cat-dropdown')?.classList.remove('open');
  }

  // ----- Левый сайдбар: список общих + специфичных, или результаты поиска -----
  function renderObjLists() {
    const q = (state.objSearch || '').trim().toLowerCase();
    const resultsSec = $('#kb-obj-results-section');
    const generalSec = $('#kb-obj-general-section');
    const specificSec = $('#kb-obj-specific-section');
    if (!resultsSec || !generalSec || !specificSec) return;

    if (q) {
      const matches = state.objs.filter(o => {
        const hay = [o.title, o.answer, o.details || '', o.keywords || ''].join(' ').toLowerCase();
        return hay.includes(q);
      });
      resultsSec.hidden = false;
      generalSec.hidden = true;
      specificSec.hidden = true;
      const el = $('#kb-obj-results');
      if (!matches.length) {
        el.innerHTML = `<div class="empty plain" style="font-size:13px;padding:12px;color:var(--muted);">Ничего не найдено по запросу «${esc(q)}»</div>`;
      } else {
        el.innerHTML = matches.map(objBtn).join('');
      }
      bindObjItemClicks();
      highlightActiveObj();
      return;
    }

    resultsSec.hidden = true;
    generalSec.hidden = false;

    const general = state.objs.filter(o => o.is_general);
    $('#kb-obj-general').innerHTML = general.length
      ? general.map(objBtn).join('')
      : '<div class="empty plain" style="font-size:13px;padding:12px;color:var(--muted);">Пока нет общих возражений</div>';

    const specific = state.objActiveCatId === null
      ? state.objs.filter(o => !o.is_general)
      : state.objs.filter(o => !o.is_general && o.category_id === state.objActiveCatId);
    if (specific.length) {
      specificSec.hidden = false;
      $('#kb-obj-specific-title').textContent = state.objActiveCatId
        ? (state.cats.find(c => c.id === state.objActiveCatId)?.name || 'Рубрика')
        : 'Специфичные';
      $('#kb-obj-specific').innerHTML = specific.map(objBtn).join('');
    } else {
      specificSec.hidden = true;
    }

    bindObjItemClicks();
    highlightActiveObj();
  }

  function objBtn(o) {
    return `<button class="kb-doc-item" type="button" data-obj-id="${esc(o.id)}">${esc(o.title)}</button>`;
  }

  function bindObjItemClicks() {
    document.querySelectorAll('.kb-docs-sidebar .kb-doc-item[data-obj-id]').forEach(b => {
      b.onclick = () => openObj(b.dataset.objId);
    });
  }

  function highlightActiveObj() {
    const cur = state.objCurrent?.id;
    document.querySelectorAll('.kb-docs-sidebar .kb-doc-item[data-obj-id]').forEach(b => {
      b.classList.toggle('active', !!cur && b.dataset.objId === cur);
    });
  }

  function openObj(id) {
    const o = state.objs.find(x => x.id === id);
    if (!o) return;
    state.objCurrent = o;
    state.objView = 'answer'; // при смене возражения возвращаемся к режиму «Ответ»
    renderObjPane();
    highlightActiveObj();
  }

  // ----- Правая панель: ответ / описание + копирование -----
  function renderObjPane() {
    const pane = $('#kb-obj-pane');
    const o = state.objCurrent;
    if (!pane || !o) return;
    const hasDetails = !!(o.details && String(o.details).trim());
    const isDetails = state.objView === 'details' && hasDetails;
    const visible = isDetails ? o.details : o.answer;
    const detailsBtnLabel = isDetails ? '← К ответу' : '📖 Подробно о возражении';
    const copyBtnLabel = isDetails ? '📋 Скопировать описание' : '📋 Скопировать ответ';
    pane.innerHTML = `
      <div class="kb-obj-pane-head">
        <h1>${esc(o.title)}</h1>
        ${hasDetails ? `<button class="btn details-toggle${isDetails ? ' active' : ''}" id="kb-obj-details-toggle" type="button">${esc(detailsBtnLabel)}</button>` : ''}
      </div>
      <div class="kb-obj-text${isDetails ? ' details' : ''}">${safeHtml(visible)}</div>
      <div class="kb-doc-actions">
        <button class="btn primary" id="kb-obj-copy" type="button">${esc(copyBtnLabel)}</button>
      </div>`;
    pane.querySelector('#kb-obj-copy').addEventListener('click', async () => {
      const plain = htmlToPlain(visible);
      try {
        await navigator.clipboard.writeText(plain);
        toast(isDetails ? 'Описание скопировано' : 'Ответ скопирован в буфер');
      } catch { toast('Не удалось скопировать'); }
    });
    pane.querySelector('#kb-obj-details-toggle')?.addEventListener('click', () => {
      state.objView = isDetails ? 'answer' : 'details';
      renderObjPane();
    });
  }

  function htmlToPlain(html) {
    const tmp = document.createElement('div');
    tmp.innerHTML = html || '';
    return (tmp.textContent || '').trim();
  }

  // ----- Одноразовая привязка обработчиков поиска и дропдауна -----
  function bindObjUIOnce() {
    if (state.objBoundUI) return;
    state.objBoundUI = true;

    const search = $('#kb-obj-search');
    if (search) {
      let t;
      search.addEventListener('input', () => {
        state.objSearch = search.value || '';
        clearTimeout(t);
        t = setTimeout(renderObjLists, 180);
      });
    }

    const trigger = $('#kb-obj-cat-trigger');
    const menu = $('#kb-obj-cat-menu');
    const dropdown = $('#kb-obj-cat-dropdown');
    if (trigger && menu && dropdown) {
      trigger.addEventListener('click', (e) => {
        e.stopPropagation();
        const willOpen = menu.classList.contains('hidden');
        menu.classList.toggle('hidden');
        dropdown.classList.toggle('open', willOpen);
      });
      document.addEventListener('click', (e) => {
        if (!dropdown.contains(e.target)) closeObjCatMenu();
      });
      document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') closeObjCatMenu();
      });
    }
  }

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
