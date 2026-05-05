// ============================================================
// Логика админ-панели
// ============================================================

// Гардинг: только админ может видеть админку.
// cabinetShell проверит роль, нарисует переключатель ролей в шапке и привяжет logout.
(async () => {
  await cabinetShell.init({ requiredRole: 'admin', greetingPrefix: 'Админ' });
  init();
})();

const tabs = document.querySelectorAll('.admin-nav a[data-tab]');
tabs.forEach(a => a.addEventListener('click', (e) => {
  if (!a.dataset.tab) return;
  e.preventDefault();
  tabs.forEach(x => x.classList.remove('active'));
  a.classList.add('active');
  document.querySelectorAll('.tab').forEach(t => t.classList.add('hidden'));
  document.getElementById('tab-' + a.dataset.tab).classList.remove('hidden');
  location.hash = a.dataset.tab;
}));

function init() {
  // Переход по хэшу
  const hash = location.hash.replace('#','');
  if (hash) {
    const link = document.querySelector(`.admin-nav a[data-tab="${hash}"]`);
    if (link) link.click();
  }
  loadCategories();
  loadObjections();
  loadCheatsheet();
  loadDocuments();
  loadOperators();
  loadUsers();
}

// ---------- Модалка (универсальная) ----------
const modal = document.getElementById('modal');
const modalTitle = document.getElementById('modal-title');
const modalBody = document.getElementById('modal-body');
document.getElementById('modal-close').addEventListener('click', closeModal);
// Закрываем модалку кликом по подложке, только если клик и начался, и закончился на ней.
// Иначе выделение текста в поле с отпусканием за пределами формы закрывает модалку.
let _modalDownOnBackdrop = false;
modal.addEventListener('mousedown', e => { _modalDownOnBackdrop = (e.target.id === 'modal'); });
modal.addEventListener('click', e => {
  if (e.target.id === 'modal' && _modalDownOnBackdrop) closeModal();
  _modalDownOnBackdrop = false;
});
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeModal(); });

function openModal(title, bodyHtml) {
  modalTitle.textContent = title;
  modalBody.innerHTML = bodyHtml;
  modal.classList.remove('hidden');
}
function closeModal() { modal.classList.add('hidden'); }

function toast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.remove('hidden');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => t.classList.add('hidden'), 1800);
}

async function confirmDelete(name) {
  return confirm(`Удалить «${name}»? Действие необратимо.`);
}

// ============================================================
// РУБРИКИ
// ============================================================
let categoriesCache = [];

async function loadCategories() {
  const { data, error } = await sb.from('categories').select('*').order('sort_order');
  if (error) { toast('Ошибка: ' + error.message); return; }
  categoriesCache = data || [];
  const tbody = document.querySelector('#cat-table tbody');
  if (!categoriesCache.length) {
    tbody.innerHTML = `<tr><td colspan="4" class="empty">Пока нет рубрик</td></tr>`;
    return;
  }
  tbody.innerHTML = categoriesCache.map(c => `
    <tr>
      <td><strong>${escapeHtml(c.name)}</strong></td>
      <td style="font-size:22px;">${escapeHtml(c.icon || '')}</td>
      <td>${c.sort_order}</td>
      <td class="actions-cell">
        <button class="btn sm" data-edit="${c.id}">Редактировать</button>
        <button class="btn sm danger" data-del="${c.id}">Удалить</button>
      </td>
    </tr>`).join('');
  tbody.querySelectorAll('[data-edit]').forEach(b => b.addEventListener('click', () => editCategory(b.dataset.edit)));
  tbody.querySelectorAll('[data-del]').forEach(b => b.addEventListener('click', () => deleteCategory(b.dataset.del)));
}

document.getElementById('cat-add').addEventListener('click', () => editCategory(null));

function editCategory(id) {
  const c = id ? categoriesCache.find(x => x.id === id) : { name:'', icon:'📁', sort_order:0 };
  openModal(id ? 'Редактировать рубрику' : 'Новая рубрика', `
    <form class="form-grid" id="cat-form">
      <label><div class="lbl">Название</div>
        <input type="text" name="name" value="${escapeHtml(c.name)}" required></label>
      <label><div class="lbl">Иконка (эмодзи)</div>
        <input type="text" name="icon" value="${escapeHtml(c.icon || '')}" maxlength="4"></label>
      <label><div class="lbl">Порядок сортировки</div>
        <input type="number" name="sort_order" value="${c.sort_order ?? 0}"></label>
      <div class="row"><button type="submit" class="btn primary">Сохранить</button>
        <button type="button" class="btn" id="cancel">Отмена</button></div>
    </form>`);
  document.getElementById('cancel').addEventListener('click', closeModal);
  document.getElementById('cat-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const payload = {
      name: fd.get('name'),
      icon: fd.get('icon'),
      sort_order: Number(fd.get('sort_order')) || 0,
    };
    const { error } = id
      ? await sb.from('categories').update(payload).eq('id', id)
      : await sb.from('categories').insert(payload);
    if (error) { toast('Ошибка: ' + error.message); return; }
    closeModal(); toast('Сохранено'); loadCategories(); loadObjections();
  });
}

async function deleteCategory(id) {
  const c = categoriesCache.find(x => x.id === id);
  if (!c) return;
  // Проверим, есть ли возражения в этой рубрике
  const { count } = await sb.from('objections').select('id', { count:'exact', head:true }).eq('category_id', id);
  let action = 'orphan'; // по умолчанию — переносим в «Без рубрики» (category_id = null)
  if (count && count > 0) {
    const choice = prompt(
      `В рубрике «${c.name}» есть ${count} возражений.\n` +
      `Что сделать?\n\n` +
      `  1 — удалить вместе с рубрикой\n` +
      `  2 — оставить их без рубрики\n\n` +
      `Введите 1 или 2:`, '2');
    if (choice === null) return;
    action = choice === '1' ? 'delete' : 'orphan';
  } else {
    if (!await confirmDelete(c.name)) return;
  }
  if (action === 'delete') {
    const { error: e1 } = await sb.from('objections').delete().eq('category_id', id);
    if (e1) { toast('Ошибка: ' + e1.message); return; }
  } else {
    const { error: e1 } = await sb.from('objections').update({ category_id: null }).eq('category_id', id);
    if (e1) { toast('Ошибка: ' + e1.message); return; }
  }
  const { error } = await sb.from('categories').delete().eq('id', id);
  if (error) { toast('Ошибка: ' + error.message); return; }
  toast('Удалено'); loadCategories(); loadObjections();
}

// ============================================================
// ВОЗРАЖЕНИЯ
// ============================================================
let objectionsCache = [];

async function loadObjections() {
  const [objRes, cmtRes] = await Promise.all([
    sb.from('objections').select('*').order('sort_order'),
    sb.from('objection_comments').select('objection_id'),
  ]);
  if (objRes.error) { toast('Ошибка: ' + objRes.error.message); return; }
  objectionsCache = objRes.data || [];

  // Считаем комментарии по каждому возражению
  const commentCounts = {};
  (cmtRes.data || []).forEach(c => {
    commentCounts[c.objection_id] = (commentCounts[c.objection_id] || 0) + 1;
  });

  const tbody = document.querySelector('#obj-table tbody');
  if (!objectionsCache.length) {
    tbody.innerHTML = `<tr><td colspan="6" class="empty">Пока нет возражений</td></tr>`;
    return;
  }
  tbody.innerHTML = objectionsCache.map(o => {
    const catName = o.is_general
      ? '<span class="badge">Общее</span>'
      : (o.category_id
          ? `<span class="badge muted">${escapeHtml(categoriesCache.find(c => c.id === o.category_id)?.name || '—')}</span>`
          : '<span class="badge muted">Без рубрики</span>');
    const n = commentCounts[o.id] || 0;
    const cmtCell = n > 0
      ? `<button class="btn sm" data-comments="${o.id}">💬 ${n}</button>`
      : '<span class="muted" style="font-size:13px;">—</span>';
    return `
    <tr>
      <td><strong>${escapeHtml(o.title)}</strong></td>
      <td>${catName}</td>
      <td>${o.is_active ? '<span class="badge">Активно</span>' : '<span class="badge off">Скрыто</span>'}</td>
      <td>${cmtCell}</td>
      <td>${o.sort_order}</td>
      <td class="actions-cell">
        <button class="btn sm" data-edit="${o.id}">Ред.</button>
        <button class="btn sm" data-toggle="${o.id}">${o.is_active ? 'Скрыть' : 'Показать'}</button>
        <button class="btn sm danger" data-del="${o.id}">Удалить</button>
      </td>
    </tr>`;
  }).join('');
  tbody.querySelectorAll('[data-edit]').forEach(b => b.addEventListener('click', () => editObjection(b.dataset.edit)));
  tbody.querySelectorAll('[data-toggle]').forEach(b => b.addEventListener('click', () => toggleObjection(b.dataset.toggle)));
  tbody.querySelectorAll('[data-del]').forEach(b => b.addEventListener('click', () => deleteObjection(b.dataset.del)));
  tbody.querySelectorAll('[data-comments]').forEach(b => b.addEventListener('click', () => viewComments(b.dataset.comments)));
}

async function viewComments(objectionId) {
  const o = objectionsCache.find(x => x.id === objectionId);
  if (!o) return;
  openModal(`Комментарии: ${o.title}`, `<div id="cmt-container"><div class="empty">Загружаем…</div></div>`);
  await loadCommentsInto(objectionId);
}

async function loadCommentsInto(objectionId) {
  const { data, error } = await sb.from('objection_comments')
    .select('*')
    .eq('objection_id', objectionId)
    .order('created_at', { ascending: false });
  const container = document.getElementById('cmt-container');
  if (!container) return;
  if (error) { container.innerHTML = `<div class="empty">Ошибка: ${escapeHtml(error.message)}</div>`; return; }
  if (!data.length) { container.innerHTML = `<div class="empty">Пока нет комментариев.</div>`; return; }
  container.innerHTML = `<div class="comments-list">${data.map(c => `
    <div class="comment-card">
      <div class="meta">
        <span>${new Date(c.created_at).toLocaleString('ru-RU')}</span>
        <button class="btn sm danger" data-cmt-del="${c.id}">Удалить</button>
      </div>
      <div class="text">${escapeHtml(c.comment_text)}</div>
    </div>`).join('')}</div>`;
  container.querySelectorAll('[data-cmt-del]').forEach(b => b.addEventListener('click', async () => {
    if (!confirm('Удалить этот комментарий?')) return;
    const { error } = await sb.from('objection_comments').delete().eq('id', b.dataset.cmtDel);
    if (error) { toast('Ошибка: ' + error.message); return; }
    toast('Удалено');
    await loadCommentsInto(objectionId);
    loadObjections();
  }));
}

document.getElementById('obj-add').addEventListener('click', () => editObjection(null));

function editObjection(id) {
  const o = id ? objectionsCache.find(x => x.id === id) : { title:'', answer:'', details:'', category_id:null, is_general:true, keywords:'', sort_order:0, is_active:true };
  const catOptions = categoriesCache.map(c =>
    `<option value="${c.id}" ${o.category_id === c.id ? 'selected' : ''}>${escapeHtml(c.name)}</option>`).join('');
  openModal(id ? 'Редактировать возражение' : 'Новое возражение', `
    <form class="form-grid" id="obj-form">
      <label><div class="lbl">Заголовок (что говорит клиент)</div>
        <input type="text" name="title" value="${escapeHtml(o.title)}" required></label>
      <label><div class="lbl">Текст ответа <span class="muted" style="font-weight:400;">— редактор с форматированием; жирный, размеры, списки — сохранятся при вставке из Google Docs / Word</span></div>
        <div class="rte" id="answer-editor"></div></label>
      <label><div class="lbl">Подробно о возражении <span class="muted" style="font-weight:400;">— оператор откроет этот текст кнопкой «📖 Подробно о возражении». Объясните суть возражения. Не обязательно.</span></div>
        <div class="rte" id="details-editor"></div></label>
      <label class="inline">
        <input type="checkbox" name="is_general" ${o.is_general ? 'checked' : ''}>
        <span>Общее возражение (показывать во всех рубриках)</span>
      </label>
      <label><div class="lbl">Рубрика (для не-общих)</div>
        <select name="category_id">
          <option value="">— Без рубрики —</option>
          ${catOptions}
        </select></label>
      <label><div class="lbl">Ключевые слова для поиска (через запятую)</div>
        <input type="text" name="keywords" value="${escapeHtml(o.keywords || '')}" placeholder="премиум, элитные, дорогие"></label>
      <label><div class="lbl">Порядок сортировки</div>
        <input type="number" name="sort_order" value="${o.sort_order ?? 0}"></label>
      <label class="inline">
        <input type="checkbox" name="is_active" ${o.is_active ? 'checked' : ''}>
        <span>Активно (показывать оператору)</span>
      </label>
      <div class="row"><button type="submit" class="btn primary">Сохранить</button>
        <button type="button" class="btn" id="cancel">Отмена</button></div>
    </form>`);
  document.getElementById('cancel').addEventListener('click', closeModal);

  // Подключаем rich-редакторы (Quill) к полям «Ответ» и «Подробно»
  const answerQuill = mountQuillEditor('#answer-editor', o.answer || '');
  const detailsQuill = mountQuillEditor('#details-editor', o.details || '');

  document.getElementById('obj-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const isGeneral = fd.get('is_general') === 'on';
    const payload = {
      title: fd.get('title'),
      answer: quillHtml(answerQuill),
      details: quillHtml(detailsQuill),
      is_general: isGeneral,
      category_id: isGeneral ? null : (fd.get('category_id') || null),
      keywords: fd.get('keywords') || '',
      sort_order: Number(fd.get('sort_order')) || 0,
      is_active: fd.get('is_active') === 'on',
    };
    if (!payload.answer.trim()) { toast('Заполните текст ответа'); return; }
    const { error } = id
      ? await sb.from('objections').update(payload).eq('id', id)
      : await sb.from('objections').insert(payload);
    if (error) { toast('Ошибка: ' + error.message); return; }
    closeModal(); toast('Сохранено'); loadObjections();
  });
}

// --- Rich-text helpers (Quill) ---
function mountQuillEditor(selector, initialHtml) {
  if (typeof Quill === 'undefined') {
    // Fallback — если Quill не подгрузился, подменим div обычной textarea,
    // чтобы админ мог хотя бы сохранить plain text.
    const el = document.querySelector(selector);
    if (!el) return null;
    const ta = document.createElement('textarea');
    ta.value = initialHtml || '';
    ta.style.width = '100%'; ta.style.minHeight = '160px';
    el.replaceWith(ta);
    return { root: ta, _isTextarea: true };
  }
  const quill = new Quill(selector, {
    theme: 'snow',
    modules: {
      toolbar: [
        [{ 'header': [1, 2, 3, false] }],
        [{ 'size': ['small', false, 'large', 'huge'] }],
        ['bold', 'italic', 'underline', 'strike'],
        [{ 'color': [] }, { 'background': [] }],
        [{ 'list': 'ordered' }, { 'list': 'bullet' }],
        [{ 'align': [] }],
        ['link', 'blockquote'],
        ['clean'],
      ],
    },
    placeholder: 'Введите текст или вставьте из документа — форматирование сохранится',
  });
  if (initialHtml) quill.root.innerHTML = initialHtml;
  return quill;
}

function quillHtml(editor) {
  if (!editor) return '';
  if (editor._isTextarea) return editor.root.value.trim();
  const html = editor.root.innerHTML.trim();
  // Пустой редактор Quill — `<p><br></p>`. Считаем это как ''.
  return html === '<p><br></p>' ? '' : html;
}

async function toggleObjection(id) {
  const o = objectionsCache.find(x => x.id === id);
  const { error } = await sb.from('objections').update({ is_active: !o.is_active }).eq('id', id);
  if (error) { toast('Ошибка: ' + error.message); return; }
  loadObjections();
}

async function deleteObjection(id) {
  const o = objectionsCache.find(x => x.id === id);
  if (!o || !await confirmDelete(o.title)) return;
  const { error } = await sb.from('objections').delete().eq('id', id);
  if (error) { toast('Ошибка: ' + error.message); return; }
  toast('Удалено'); loadObjections();
}

// ============================================================
// ШПАРГАЛКА
// ============================================================
let cheatCache = [];

async function loadCheatsheet() {
  const { data, error } = await sb.from('cheatsheet_blocks').select('*').order('sort_order');
  if (error) { toast('Ошибка: ' + error.message); return; }
  cheatCache = data || [];
  const tbody = document.querySelector('#cheat-table tbody');
  if (!cheatCache.length) {
    tbody.innerHTML = `<tr><td colspan="3" class="empty">Пока нет блоков</td></tr>`;
    return;
  }
  tbody.innerHTML = cheatCache.map(b => `
    <tr>
      <td><strong>${escapeHtml(b.title)}</strong></td>
      <td>${b.sort_order}</td>
      <td class="actions-cell">
        <button class="btn sm" data-edit="${b.id}">Ред.</button>
        <button class="btn sm danger" data-del="${b.id}">Удалить</button>
      </td>
    </tr>`).join('');
  tbody.querySelectorAll('[data-edit]').forEach(b => b.addEventListener('click', () => editCheat(b.dataset.edit)));
  tbody.querySelectorAll('[data-del]').forEach(b => b.addEventListener('click', () => deleteCheat(b.dataset.del)));
}

document.getElementById('cheat-add').addEventListener('click', () => editCheat(null));

function editCheat(id) {
  const b = id ? cheatCache.find(x => x.id === id) : { title:'', content:'', sort_order:0 };
  openModal(id ? 'Редактировать блок' : 'Новый блок шпаргалки', `
    <form class="form-grid" id="cheat-form">
      <label><div class="lbl">Заголовок</div>
        <input type="text" name="title" value="${escapeHtml(b.title)}" required></label>
      <label><div class="lbl">Текст (поддерживает **жирный**, списки через -, переносы строк)</div>
        <textarea name="content" required>${escapeHtml(b.content)}</textarea></label>
      <label><div class="lbl">Порядок сортировки</div>
        <input type="number" name="sort_order" value="${b.sort_order ?? 0}"></label>
      <div class="row"><button type="submit" class="btn primary">Сохранить</button>
        <button type="button" class="btn" id="cancel">Отмена</button></div>
    </form>`);
  document.getElementById('cancel').addEventListener('click', closeModal);
  document.getElementById('cheat-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const payload = {
      title: fd.get('title'),
      content: fd.get('content'),
      sort_order: Number(fd.get('sort_order')) || 0,
    };
    const { error } = id
      ? await sb.from('cheatsheet_blocks').update(payload).eq('id', id)
      : await sb.from('cheatsheet_blocks').insert(payload);
    if (error) { toast('Ошибка: ' + error.message); return; }
    closeModal(); toast('Сохранено'); loadCheatsheet();
  });
}

async function deleteCheat(id) {
  const b = cheatCache.find(x => x.id === id);
  if (!b || !await confirmDelete(b.title)) return;
  const { error } = await sb.from('cheatsheet_blocks').delete().eq('id', id);
  if (error) { toast('Ошибка: ' + error.message); return; }
  toast('Удалено'); loadCheatsheet();
}

// ============================================================
// ДОКУМЕНТЫ
// ============================================================
let docsCache = [];

async function loadDocuments() {
  const { data, error } = await sb.from('documents').select('*').order('sort_order');
  if (error) { toast('Ошибка: ' + error.message); return; }
  docsCache = data || [];
  const tbody = document.querySelector('#doc-table tbody');
  if (!docsCache.length) {
    tbody.innerHTML = `<tr><td colspan="4" class="empty">Пока нет документов</td></tr>`;
    return;
  }
  tbody.innerHTML = docsCache.map(d => `
    <tr>
      <td><strong>${escapeHtml(d.name)}</strong>${d.description ? `<br><span class="muted" style="font-size:12px;">${escapeHtml(d.description)}</span>` : ''}</td>
      <td><a href="${escapeHtml(d.url)}" target="_blank" style="font-size:12px;">${escapeHtml(d.url.slice(0, 40))}${d.url.length > 40 ? '…' : ''}</a></td>
      <td>${d.sort_order}</td>
      <td class="actions-cell">
        <button class="btn sm" data-edit="${d.id}">Ред.</button>
        <button class="btn sm danger" data-del="${d.id}">Удалить</button>
      </td>
    </tr>`).join('');
  tbody.querySelectorAll('[data-edit]').forEach(b => b.addEventListener('click', () => editDoc(b.dataset.edit)));
  tbody.querySelectorAll('[data-del]').forEach(b => b.addEventListener('click', () => deleteDoc(b.dataset.del)));
}

document.getElementById('doc-add').addEventListener('click', () => editDoc(null));

function editDoc(id) {
  const d = id ? docsCache.find(x => x.id === id) : { name:'', url:'', description:'', sort_order:0 };
  openModal(id ? 'Редактировать документ' : 'Новый документ', `
    <form class="form-grid" id="doc-form">
      <label><div class="lbl">Название</div>
        <input type="text" name="name" value="${escapeHtml(d.name)}" required></label>
      <label><div class="lbl">URL (ссылка)</div>
        <input type="url" name="url" value="${escapeHtml(d.url)}" required placeholder="https://…"></label>
      <label><div class="lbl">Описание (необязательно)</div>
        <input type="text" name="description" value="${escapeHtml(d.description || '')}"></label>
      <label><div class="lbl">Порядок сортировки</div>
        <input type="number" name="sort_order" value="${d.sort_order ?? 0}"></label>
      <div class="row"><button type="submit" class="btn primary">Сохранить</button>
        <button type="button" class="btn" id="cancel">Отмена</button></div>
    </form>`);
  document.getElementById('cancel').addEventListener('click', closeModal);
  document.getElementById('doc-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const payload = {
      name: fd.get('name'),
      url: fd.get('url'),
      description: fd.get('description') || null,
      sort_order: Number(fd.get('sort_order')) || 0,
    };
    const { error } = id
      ? await sb.from('documents').update(payload).eq('id', id)
      : await sb.from('documents').insert(payload);
    if (error) { toast('Ошибка: ' + error.message); return; }
    closeModal(); toast('Сохранено'); loadDocuments();
  });
}

async function deleteDoc(id) {
  const d = docsCache.find(x => x.id === id);
  if (!d || !await confirmDelete(d.name)) return;
  const { error } = await sb.from('documents').delete().eq('id', id);
  if (error) { toast('Ошибка: ' + error.message); return; }
  toast('Удалено'); loadDocuments();
}

// ============================================================
// ОПЕРАТОРЫ
// ============================================================
let opsCache = [];

function formatOpDate(iso) {
  const d = new Date(iso);
  return d.toLocaleDateString('ru-RU', { day:'numeric', month:'short', year:'numeric' });
}

function renderPasswordCell(pw) {
  if (!pw) return '<span class="muted" style="font-size:12px;">— не задан —</span>';
  const safe = escapeHtml(pw);
  return `
    <span class="pw-cell">
      <code class="pw-value" data-pw="${safe}" data-shown="0">••••••••</code>
      <button class="btn sm pw-toggle" type="button" title="Показать/скрыть">👁</button>
      <button class="btn sm pw-copy" type="button" data-pw="${safe}" title="Скопировать">📋</button>
    </span>`;
}

async function loadOperators() {
  const { data, error } = await sb.from('operators')
    .select('id, name, login, password, is_active, created_at')
    .order('created_at', { ascending: false });
  if (error) {
    const tbody = document.querySelector('#op-table tbody');
    tbody.innerHTML = `<tr><td colspan="6" class="empty">Ошибка: ${escapeHtml(error.message)}. Выполни миграции sql/migration_02_operators.sql и sql/migration_04_plain_passwords_and_stats.sql в Supabase.</td></tr>`;
    return;
  }
  opsCache = data || [];
  const tbody = document.querySelector('#op-table tbody');
  if (!opsCache.length) {
    tbody.innerHTML = `<tr><td colspan="6" class="empty">Операторов пока нет</td></tr>`;
    return;
  }
  tbody.innerHTML = opsCache.map(op => `
    <tr>
      <td><strong>${escapeHtml(op.name)}</strong></td>
      <td><code style="font-size:13px;">${escapeHtml(op.login)}</code></td>
      <td>${renderPasswordCell(op.password)}</td>
      <td>${op.is_active
        ? '<span class="badge" style="background:var(--success-soft);color:var(--success);">Активен</span>'
        : '<span class="badge muted">Отключён</span>'}</td>
      <td style="color:var(--muted);font-size:13px;">${formatOpDate(op.created_at)}</td>
      <td class="actions-cell">
        <button class="btn sm" data-edit="${op.id}">Ред.</button>
        <button class="btn sm danger" data-del="${op.id}">Удалить</button>
      </td>
    </tr>`).join('');
  tbody.querySelectorAll('[data-edit]').forEach(b => b.addEventListener('click', () => editOp(b.dataset.edit)));
  tbody.querySelectorAll('[data-del]').forEach(b => b.addEventListener('click', () => deleteOp(b.dataset.del)));
  tbody.querySelectorAll('.pw-toggle').forEach(b => b.addEventListener('click', (e) => {
    const cell = e.currentTarget.parentElement.querySelector('.pw-value');
    const shown = cell.dataset.shown === '1';
    cell.textContent = shown ? '••••••••' : cell.dataset.pw;
    cell.dataset.shown = shown ? '0' : '1';
  }));
  tbody.querySelectorAll('.pw-copy').forEach(b => b.addEventListener('click', async (e) => {
    try { await navigator.clipboard.writeText(e.currentTarget.dataset.pw); toast('Пароль скопирован'); }
    catch { toast('Не удалось скопировать'); }
  }));
}

document.getElementById('op-add').addEventListener('click', () => editOp(null));

function editOp(id) {
  const op = id ? opsCache.find(x => x.id === id) : { name:'', login:'', password:'', is_active: true };
  const isNew = !id;
  openModal(isNew ? 'Новый оператор' : 'Редактировать оператора', `
    <form class="form-grid" id="op-form">
      <label><div class="lbl">Имя</div>
        <input type="text" name="name" value="${escapeHtml(op.name)}" required placeholder="Иван Петров"></label>
      <label><div class="lbl">Логин</div>
        <input type="text" name="login" value="${escapeHtml(op.login)}" required
               autocomplete="off" pattern="[A-Za-z0-9_.\\-]{3,32}"
               title="Латиница, цифры, _ . - (3–32 символа)"
               placeholder="ivan.petrov">
      </label>
      <label><div class="lbl">Пароль</div>
        <input type="text" name="password" value="${escapeHtml(op.password || '')}" ${isNew ? 'required' : ''}
               autocomplete="new-password" minlength="6" placeholder="Минимум 6 символов"></label>
      ${isNew ? '' : `
      <label style="display:flex;align-items:center;gap:8px;">
        <input type="checkbox" name="is_active" ${op.is_active ? 'checked' : ''}>
        <span>Активен (может заходить на сайт)</span>
      </label>`}
      <div class="row">
        <button type="submit" class="btn primary">Сохранить</button>
        <button type="button" class="btn" id="cancel">Отмена</button>
      </div>
    </form>`);
  document.getElementById('cancel').addEventListener('click', closeModal);
  document.getElementById('op-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const name = String(fd.get('name')).trim();
    const login = String(fd.get('login')).trim().toLowerCase();
    const password = String(fd.get('password') || '');
    const payload = { name, login };
    if (!isNew) payload.is_active = fd.has('is_active');
    if (password) {
      if (password.length < 6) { toast('Пароль минимум 6 символов'); return; }
      payload.password = password;
    } else if (isNew) {
      toast('Задайте пароль'); return;
    }
    const btn = e.submitter;
    btn.disabled = true; btn.textContent = 'Сохраняем…';
    const { error } = isNew
      ? await sb.from('operators').insert(payload)
      : await sb.from('operators').update(payload).eq('id', id);
    btn.disabled = false; btn.textContent = 'Сохранить';
    if (error) {
      const msg = error.message.includes('operators_login_key') || error.code === '23505'
        ? 'Логин уже занят — выбери другой'
        : 'Ошибка: ' + error.message;
      toast(msg);
      return;
    }
    closeModal(); toast('Сохранено'); loadOperators();
  });
}

async function deleteOp(id) {
  const op = opsCache.find(x => x.id === id);
  if (!op || !await confirmDelete(`оператора «${op.name}»`)) return;
  const { error } = await sb.from('operators').delete().eq('id', id);
  if (error) { toast('Ошибка: ' + error.message); return; }
  toast('Удалено'); loadOperators();
}

// ============================================================
// ПОЛЬЗОВАТЕЛИ ХАБА (public.users + auth.users)
// ============================================================
// Чтение: select из public.users (RLS: админ видит всех).
// Изменение ролей и status: update public.users (RLS: админ может).
// Создание (приглашение): требует Auth Admin API → нужен Worker handler;
// пока заглушка показывает curl-команду для самостоятельного запуска.

const ROLE_LABELS = {
  admin: 'Админ', operator: 'Оператор', seller: 'Продажник', marketer: 'Маркетолог',
};
const ALL_ROLES = ['admin', 'operator', 'seller', 'marketer'];
let usersCache = [];

async function loadUsers() {
  const { data, error } = await sb
    .from('users')
    .select('id, email, full_name, roles, status, created_at')
    .order('created_at', { ascending: false });
  if (error) { toast('Ошибка users: ' + error.message); return; }
  usersCache = data || [];
  renderUsers();
}

function renderUsers() {
  const tbody = document.querySelector('#user-table tbody');
  const search = (document.getElementById('user-search')?.value || '').trim().toLowerCase();
  const activeFilters = ALL_ROLES.filter(r => document.getElementById('filter-' + r)?.checked);

  let list = usersCache;
  if (search) {
    list = list.filter(u =>
      (u.email || '').toLowerCase().includes(search) ||
      (u.full_name || '').toLowerCase().includes(search)
    );
  }
  if (activeFilters.length) {
    list = list.filter(u => activeFilters.every(r => (u.roles || []).includes(r)));
  }

  if (!list.length) {
    tbody.innerHTML = `<tr><td colspan="6" class="empty">Никого не найдено</td></tr>`;
    return;
  }
  tbody.innerHTML = list.map(u => {
    const roleBadges = (u.roles || []).map(r =>
      `<span class="role-badge role-${r}">${ROLE_LABELS[r] || r}</span>`
    ).join(' ') || '<span style="color:var(--muted);">—</span>';
    const statusBadge = u.status === 'active'
      ? '<span class="status-badge status-active">Активен</span>'
      : '<span class="status-badge status-disabled">Отключён</span>';
    const created = u.created_at ? new Date(u.created_at).toLocaleDateString('ru-RU') : '—';
    const toggleLabel = u.status === 'active' ? 'Отключить' : 'Включить';
    const toggleClass = u.status === 'active' ? 'danger' : 'primary';
    return `
      <tr>
        <td><strong>${escapeHtml(u.full_name || '—')}</strong></td>
        <td>${escapeHtml(u.email || '')}</td>
        <td>${roleBadges}</td>
        <td>${statusBadge}</td>
        <td style="white-space:nowrap;">${created}</td>
        <td class="actions-cell">
          <button class="btn sm" data-edit-user="${u.id}">Редактировать</button>
          <button class="btn sm ${toggleClass}" data-toggle-user="${u.id}">${toggleLabel}</button>
        </td>
      </tr>`;
  }).join('');
  tbody.querySelectorAll('[data-edit-user]').forEach(b =>
    b.addEventListener('click', () => editUser(b.dataset.editUser)));
  tbody.querySelectorAll('[data-toggle-user]').forEach(b =>
    b.addEventListener('click', () => toggleUserStatus(b.dataset.toggleUser)));
}

document.getElementById('user-add')?.addEventListener('click', () => inviteUserModal());
document.getElementById('user-search')?.addEventListener('input', renderUsers);
ALL_ROLES.forEach(r =>
  document.getElementById('filter-' + r)?.addEventListener('change', renderUsers));

function inviteUserModal() {
  const checks = ALL_ROLES.map(r => `
    <label class="inline">
      <input type="checkbox" name="role" value="${r}">
      <span>${ROLE_LABELS[r]}</span>
    </label>`).join('');
  openModal('Пригласить пользователя', `
    <form class="form-grid" id="invite-form">
      <label><div class="lbl">Email</div>
        <input type="email" name="email" required autocomplete="off"></label>
      <label><div class="lbl">Имя (необязательно)</div>
        <input type="text" name="full_name"></label>
      <div>
        <div class="lbl">Роли</div>
        <div style="display:flex;gap:16px;flex-wrap:wrap;">${checks}</div>
      </div>
      <div class="row">
        <button type="submit" class="btn primary" id="invite-submit">Отправить приглашение</button>
        <button type="button" class="btn" id="invite-cancel">Отмена</button>
      </div>
      <div class="error" id="invite-error" hidden></div>
    </form>`);
  document.getElementById('invite-cancel').addEventListener('click', closeModal);
  document.getElementById('invite-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const errEl = document.getElementById('invite-error');
    const btn = document.getElementById('invite-submit');
    errEl.hidden = true;
    const fd = new FormData(e.target);
    const email = (fd.get('email') || '').toString().trim();
    const full_name = (fd.get('full_name') || '').toString().trim();
    const roles = fd.getAll('role');
    if (!email || roles.length === 0) {
      errEl.textContent = 'Email и хотя бы одна роль обязательны';
      errEl.hidden = false;
      return;
    }
    btn.disabled = true; btn.textContent = 'Отправляем…';
    try {
      const { data: { session } } = await sb.auth.getSession();
      const resp = await fetch('/api/v1/admin/invite', {
        method: 'POST',
        headers: {
          authorization: `Bearer ${session?.access_token || ''}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ email, full_name, roles }),
      });
      const body = await resp.json().catch(() => ({}));
      if (!resp.ok) {
        const msg = body.detail ? `${body.error || resp.statusText} — ${body.detail}` : (body.error || resp.statusText);
        errEl.textContent = 'Ошибка: ' + msg;
        errEl.hidden = false;
        btn.disabled = false; btn.textContent = 'Отправить приглашение';
        return;
      }
      toast('Приглашение отправлено: ' + email);
      closeModal();
      loadUsers();
    } catch (err) {
      errEl.textContent = 'Сбой: ' + (err?.message || err);
      errEl.hidden = false;
      btn.disabled = false; btn.textContent = 'Отправить приглашение';
    }
  });
}

function editUser(id) {
  const u = usersCache.find(x => x.id === id);
  if (!u) return;
  const checks = ALL_ROLES.map(r => `
    <label class="inline">
      <input type="checkbox" name="role" value="${r}" ${(u.roles || []).includes(r) ? 'checked' : ''}>
      <span>${ROLE_LABELS[r]}</span>
    </label>`).join('');
  openModal('Редактировать пользователя', `
    <form class="form-grid" id="user-form">
      <label><div class="lbl">Email</div>
        <input type="email" name="email" value="${escapeHtml(u.email || '')}" required></label>
      <label><div class="lbl">Имя</div>
        <input type="text" name="full_name" value="${escapeHtml(u.full_name || '')}"></label>
      <div>
        <div class="lbl">Роли</div>
        <div style="display:flex;gap:16px;flex-wrap:wrap;">${checks}</div>
      </div>
      <div class="row">
        <button type="submit" class="btn primary" id="user-save">Сохранить</button>
        <button type="button" class="btn" id="user-cancel">Отмена</button>
      </div>
      <div class="error" id="user-error" hidden></div>
    </form>`);
  document.getElementById('user-cancel').addEventListener('click', closeModal);
  document.getElementById('user-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const errEl = document.getElementById('user-error');
    const btn = document.getElementById('user-save');
    errEl.hidden = true;
    const fd = new FormData(e.target);
    const newEmail = (fd.get('email') || '').toString().trim();
    const full_name = (fd.get('full_name') || '').toString().trim();
    const roles = fd.getAll('role');
    btn.disabled = true; btn.textContent = 'Сохраняем…';

    // Смена email требует service_role → идём через Worker.
    if (newEmail && newEmail.toLowerCase() !== (u.email || '').toLowerCase()) {
      try {
        const { data: { session } } = await sb.auth.getSession();
        const resp = await fetch(`/api/v1/admin/users/${id}/email`, {
          method: 'PATCH',
          headers: {
            authorization: `Bearer ${session?.access_token || ''}`,
            'content-type': 'application/json',
          },
          body: JSON.stringify({ email: newEmail }),
        });
        if (!resp.ok) {
          const body = await resp.json().catch(() => ({}));
          const msg = body.detail ? `${body.error || resp.statusText} — ${body.detail}` : (body.error || resp.statusText);
          errEl.textContent = 'Email не сменился: ' + msg;
          errEl.hidden = false;
          btn.disabled = false; btn.textContent = 'Сохранить';
          return;
        }
      } catch (err) {
        errEl.textContent = 'Сбой смены email: ' + (err?.message || err);
        errEl.hidden = false;
        btn.disabled = false; btn.textContent = 'Сохранить';
        return;
      }
    }

    // full_name + roles — обычный update под RLS админа.
    const { error } = await sb.from('users').update({ full_name, roles }).eq('id', id);
    if (error) {
      errEl.textContent = 'Ошибка: ' + error.message;
      errEl.hidden = false;
      btn.disabled = false; btn.textContent = 'Сохранить';
      return;
    }
    toast('Сохранено');
    closeModal();
    loadUsers();
  });
}

async function toggleUserStatus(id) {
  const u = usersCache.find(x => x.id === id);
  if (!u) return;
  const newStatus = u.status === 'active' ? 'disabled' : 'active';
  const verb = newStatus === 'active' ? 'включить' : 'отключить';
  if (!confirm(`Точно ${verb} «${u.email}»?`)) return;
  const { error } = await sb.from('users').update({ status: newStatus }).eq('id', id);
  if (error) { toast('Ошибка: ' + error.message); return; }
  toast(newStatus === 'active' ? 'Включён' : 'Отключён');
  loadUsers();
}
