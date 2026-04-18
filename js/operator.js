// ============================================================
// Логика страницы оператора
// ============================================================

const CHEATSHEET_ID = '__cheatsheet__';

const state = {
  categories: [],
  objections: [],
  cheatsheet: [],
  documents: [],
  activeCategoryId: null,
  currentObjection: null,
};

// ---------- Загрузка данных ----------
async function loadAll() {
  const [cats, objs, cheat, docs] = await Promise.all([
    sb.from('categories').select('*').order('sort_order'),
    sb.from('objections').select('*').eq('is_active', true).order('sort_order'),
    sb.from('cheatsheet_blocks').select('*').order('sort_order'),
    sb.from('documents').select('*').order('sort_order'),
  ]);
  state.categories = cats.data || [];
  state.objections = objs.data || [];
  state.cheatsheet = cheat.data || [];
  state.documents = docs.data || [];

  renderCategoryDropdown();
  renderObjections();
  renderDocuments();
}

// ---------- Выпадающий список рубрик ----------
function renderCategoryDropdown() {
  const menu = document.getElementById('cat-menu');
  const items = [
    { id: null, name: 'Все рубрики', icon: '🗂️' },
    ...state.categories.map(c => ({ id: c.id, name: c.name, icon: c.icon || '📁' })),
  ];
  menu.innerHTML = items.map(c => `
    <button data-id="${c.id === null ? 'all' : c.id}" class="${(c.id === state.activeCategoryId) ? 'active' : ''}">
      <span class="emoji">${escapeHtml(c.icon)}</span><span>${escapeHtml(c.name)}</span>
    </button>`).join('');
  menu.querySelectorAll('button').forEach(b => {
    b.addEventListener('click', () => {
      selectCategory(b.dataset.id === 'all' ? null : b.dataset.id);
      closeDropdown();
    });
  });
  updateTriggerLabel();
}

function updateTriggerLabel() {
  const label = document.getElementById('cat-label');
  const emoji = document.getElementById('cat-emoji');
  if (state.activeCategoryId === null) {
    label.textContent = 'Все рубрики';
    emoji.textContent = '🗂️';
  } else {
    const c = state.categories.find(x => x.id === state.activeCategoryId);
    label.textContent = c?.name || 'Рубрика';
    emoji.textContent = c?.icon || '📁';
  }
}

function selectCategory(id) {
  state.activeCategoryId = id;
  // Очищаем поиск при смене рубрики
  const input = document.getElementById('search');
  if (input.value) { input.value = ''; }
  renderCategoryDropdown();
  renderObjections();
  // Скрываем результаты поиска
  document.getElementById('search-results-section').hidden = true;
  if (id) logEvent({ event_type: 'category_open', category_id: id });
}

// Открытие/закрытие меню
const trigger = document.getElementById('cat-trigger');
const dropdown = document.getElementById('cat-dropdown');
const menu = document.getElementById('cat-menu');
trigger.addEventListener('click', (e) => {
  e.stopPropagation();
  const isOpen = !menu.classList.contains('hidden');
  if (isOpen) closeDropdown(); else openDropdown();
});
document.addEventListener('click', (e) => {
  if (!dropdown.contains(e.target)) closeDropdown();
});
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeDropdown(); });

function openDropdown() { menu.classList.remove('hidden'); dropdown.classList.add('open'); }
function closeDropdown() { menu.classList.add('hidden'); dropdown.classList.remove('open'); }

// ---------- Возражения (вертикальный список в сайдбаре) ----------
function renderObjections() {
  const general = state.objections.filter(o => o.is_general);
  const generalWithCheatsheet = [...general, {
    id: CHEATSHEET_ID,
    title: 'Шпаргалки',
    is_general: true,
    is_cheatsheet: true,
  }];

  let specific = [];
  if (state.activeCategoryId !== null) {
    specific = state.objections.filter(o => !o.is_general && o.category_id === state.activeCategoryId);
  } else {
    specific = state.objections.filter(o => !o.is_general);
  }

  document.getElementById('general-list').innerHTML = generalWithCheatsheet.map(objItem).join('');

  const specSection = document.getElementById('specific-section');
  const specTitle = document.getElementById('specific-title');
  if (specific.length) {
    specSection.hidden = false;
    specTitle.textContent = state.activeCategoryId
      ? (state.categories.find(c => c.id === state.activeCategoryId)?.name || 'Рубрика')
      : 'Специфичные';
    document.getElementById('specific-list').innerHTML = specific.map(objItem).join('');
  } else {
    specSection.hidden = true;
  }

  bindItemClicks();
  highlightActiveItem();
}

function objItem(o) {
  const extraClass = o.is_cheatsheet ? ' cheatsheet' : '';
  const emoji = o.is_cheatsheet ? '📋 ' : '';
  return `<button class="sidebar-item${extraClass}" data-id="${o.id}">${emoji}${escapeHtml(o.title)}</button>`;
}

function bindItemClicks() {
  document.querySelectorAll('.sidebar-item').forEach(b => {
    b.onclick = () => openObjection(b.dataset.id);
  });
}

function highlightActiveItem() {
  const cur = state.currentObjection?.id;
  document.querySelectorAll('.sidebar-item').forEach(b => {
    b.classList.toggle('active', cur && b.dataset.id === cur);
  });
}

// ---------- Документы ----------
function renderDocuments() {
  const el = document.getElementById('documents');
  const sec = document.getElementById('documents-section');
  if (!state.documents.length) { sec.hidden = true; return; }
  sec.hidden = false;
  el.innerHTML = state.documents.map(d => `
    <div class="doc-item">
      <div class="doc-name">${escapeHtml(d.name)}</div>
      <div class="flex" style="gap:6px;">
        <a href="${escapeHtml(d.url)}" target="_blank" rel="noopener">Открыть</a>
        <button class="btn sm" data-url="${escapeHtml(d.url)}">Скопировать</button>
      </div>
    </div>
  `).join('');
  el.querySelectorAll('button[data-url]').forEach(b => {
    b.addEventListener('click', async () => {
      await copyText(b.dataset.url);
      toast('Ссылка скопирована');
    });
  });
}

// ---------- Область ответа ----------
function openObjection(id) {
  if (id === CHEATSHEET_ID) {
    state.currentObjection = { id: CHEATSHEET_ID, title: 'Шпаргалки', is_cheatsheet: true };
    renderCheatsheetPane();
    highlightActiveItem();
    return;
  }
  const o = state.objections.find(x => x.id === id);
  if (!o) return;
  state.currentObjection = o;
  renderAnswerPane();
  highlightActiveItem();
  logEvent({ event_type: 'objection_click', objection_id: o.id, category_id: o.category_id });
}

// Состояние секции комментариев в пределах открытого возражения
const commentUI = { formOpen: false, listHidden: false };

async function renderAnswerPane() {
  const pane = document.getElementById('answer-pane');
  const o = state.currentObjection;
  const comments = await loadComments(o.id);

  // При переключении возражения — состояние сбрасываем
  commentUI.formOpen = false;
  commentUI.listHidden = false;

  pane.innerHTML = `
    <h1>${escapeHtml(o.title)}</h1>
    <div class="answer-text">${formatAnswer(o.answer)}</div>
    <div class="actions">
      <button class="btn primary" id="copy-btn">📋 Скопировать ответ</button>
    </div>
    <div class="comments-section">
      <div class="comments-header">
        <span class="comments-title">
          💬 Комментарии
          <span class="count-badge" id="cmt-count">${comments.length}</span>
        </span>
        <div class="comments-actions">
          <button class="btn sm add-btn" id="cmt-toggle-form">+ Добавить</button>
          <button class="btn sm" id="cmt-toggle-list"${comments.length ? '' : ' hidden'}>Скрыть</button>
        </div>
      </div>
      <div class="comment-form hidden" id="cmt-form">
        <textarea id="cmt-input" placeholder="Заметка: что сработало, как клиент реагировал, что добавить в ответ…"></textarea>
        <div class="form-row">
          <button class="btn sm" id="cmt-cancel">Отмена</button>
          <button class="btn primary sm" id="cmt-save">Сохранить</button>
        </div>
      </div>
      <div class="comments-list-op" id="cmt-list">${renderCommentsList(comments)}</div>
    </div>`;

  pane.querySelector('#copy-btn').addEventListener('click', async () => {
    await copyText(o.answer);
    toast('Ответ скопирован в буфер');
  });
  pane.querySelector('#cmt-toggle-form').addEventListener('click', () => toggleCommentForm());
  pane.querySelector('#cmt-cancel').addEventListener('click', () => toggleCommentForm(false));
  pane.querySelector('#cmt-save').addEventListener('click', () => saveComment(o.id));
  pane.querySelector('#cmt-input').addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      saveComment(o.id);
    }
  });
  const toggleListBtn = pane.querySelector('#cmt-toggle-list');
  if (toggleListBtn) {
    toggleListBtn.addEventListener('click', () => toggleCommentsList());
  }
}

async function loadComments(objectionId) {
  try {
    const { data } = await sb.from('objection_comments')
      .select('*').eq('objection_id', objectionId)
      .order('created_at', { ascending: false });
    return data || [];
  } catch { return []; }
}

function renderCommentsList(comments) {
  if (!comments.length) return '';
  return comments.map(c => `
    <div class="comment-item">
      <div class="comment-meta">${formatDate(c.created_at)}</div>
      <div class="comment-text">${escapeHtml(c.comment_text)}</div>
    </div>`).join('');
}

function formatDate(iso) {
  const d = new Date(iso);
  return d.toLocaleString('ru-RU', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' });
}

function toggleCommentForm(forceState) {
  const form = document.getElementById('cmt-form');
  const btn = document.getElementById('cmt-toggle-form');
  const open = forceState !== undefined ? forceState : form.classList.contains('hidden');
  form.classList.toggle('hidden', !open);
  btn.classList.toggle('open', open);
  btn.textContent = open ? '× Свернуть' : '+ Добавить';
  commentUI.formOpen = open;
  if (open) {
    document.getElementById('cmt-input').focus();
  } else {
    document.getElementById('cmt-input').value = '';
  }
}

function toggleCommentsList() {
  const list = document.getElementById('cmt-list');
  const btn = document.getElementById('cmt-toggle-list');
  const hidden = list.classList.toggle('hidden');
  btn.textContent = hidden ? 'Показать' : 'Скрыть';
  commentUI.listHidden = hidden;
}

async function saveComment(objectionId) {
  const input = document.getElementById('cmt-input');
  const btn = document.getElementById('cmt-save');
  const text = input.value.trim();
  if (!text) { toast('Напишите комментарий'); input.focus(); return; }
  btn.disabled = true;
  btn.textContent = 'Сохраняем…';
  const { error } = await sb.from('objection_comments').insert({
    objection_id: objectionId,
    comment_text: text,
  });
  btn.disabled = false;
  btn.textContent = 'Сохранить';
  if (error) { toast('Ошибка: ' + error.message); return; }
  input.value = '';

  // Обновляем список и счётчик без перерисовки всего ответа
  const comments = await loadComments(objectionId);
  document.getElementById('cmt-count').textContent = comments.length;
  document.getElementById('cmt-list').innerHTML = renderCommentsList(comments);
  const toggleListBtn = document.getElementById('cmt-toggle-list');
  if (toggleListBtn) toggleListBtn.hidden = !comments.length;
  toggleCommentForm(false);
  toast(`Комментарий добавлен. Всего: ${comments.length}`);
}

function plural(n, one, few, many) {
  const mod10 = n % 10, mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return few;
  return many;
}

function renderCheatsheetPane() {
  const pane = document.getElementById('answer-pane');
  const blocks = state.cheatsheet;
  if (!blocks.length) {
    pane.innerHTML = `
      <h1>Шпаргалки</h1>
      <div class="placeholder" style="padding:40px 20px;">
        <span class="big-icon">📋</span>
        Шпаргалка пока пуста. Админ может добавить блоки.
      </div>`;
    return;
  }
  const body = blocks.map(b => `
    <div class="cs-block">
      <h3>${escapeHtml(b.title)}</h3>
      <div class="body">${formatAnswer(b.content)}</div>
    </div>`).join('');

  pane.innerHTML = `
    <h1>Шпаргалки</h1>
    <div class="cheatsheet-doc">${body}</div>
    <div class="actions">
      <button class="btn primary" id="copy-cs-btn">📋 Скопировать всё</button>
    </div>`;
  pane.querySelector('#copy-cs-btn').addEventListener('click', async () => {
    const plain = blocks.map(b => `${b.title}\n${b.content}`).join('\n\n');
    await copyText(plain);
    toast('Шпаргалка скопирована');
  });
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); } catch {}
    document.body.removeChild(ta);
  }
}

// ---------- Поиск ----------
const searchInput = document.getElementById('search');
let searchTimer = null;
searchInput.addEventListener('input', () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(runSearch, 200);
});

function runSearch() {
  const q = searchInput.value.trim().toLowerCase();
  const resultsSec = document.getElementById('search-results-section');
  const generalSec = document.getElementById('general-section');
  const specificSec = document.getElementById('specific-section');

  if (!q) {
    resultsSec.hidden = true;
    generalSec.hidden = false;
    renderObjections();
    return;
  }

  const matches = state.objections.filter(o => {
    const hay = [o.title, o.answer, o.keywords || ''].join(' ').toLowerCase();
    return hay.includes(q);
  });

  resultsSec.hidden = false;
  generalSec.hidden = true;
  specificSec.hidden = true;

  const el = document.getElementById('search-results');
  if (!matches.length) {
    el.innerHTML = `<div class="empty" style="font-size:13px;padding:24px 12px;">Ничего не найдено по запросу «${escapeHtml(q)}»</div>`;
  } else {
    el.innerHTML = matches.map(objItem).join('');
    bindItemClicks();
    highlightActiveItem();
  }

  if (q.length >= 3) {
    clearTimeout(runSearch._logTimer);
    runSearch._logTimer = setTimeout(() => {
      logEvent({ event_type: 'search', search_query: q });
    }, 800);
  }
}

// ---------- Toast ----------
function toast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.remove('hidden');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => t.classList.add('hidden'), 1800);
}

// ---------- Запуск ----------
loadAll().catch(err => {
  console.error(err);
  document.querySelector('.container').insertAdjacentHTML('afterbegin',
    '<div class="error-banner">Не удалось подключиться к базе. Проверьте <code>js/config.js</code> — URL и anon-ключ Supabase.</div>');
});
