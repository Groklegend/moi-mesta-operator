// ============================================================
// Логика админ-панели
// ============================================================

// Гардинг: без сессии — на логин
sb.auth.getSession().then(({ data }) => {
  if (!data?.session) location.replace('login.html');
  else init();
});

document.getElementById('logout').addEventListener('click', async () => {
  await sb.auth.signOut();
  location.replace('login.html');
});

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
}

// ---------- Модалка (универсальная) ----------
const modal = document.getElementById('modal');
const modalTitle = document.getElementById('modal-title');
const modalBody = document.getElementById('modal-body');
document.getElementById('modal-close').addEventListener('click', closeModal);
modal.addEventListener('click', e => { if (e.target.id === 'modal') closeModal(); });
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
  const o = id ? objectionsCache.find(x => x.id === id) : { title:'', answer:'', category_id:null, is_general:true, keywords:'', sort_order:0, is_active:true };
  const catOptions = categoriesCache.map(c =>
    `<option value="${c.id}" ${o.category_id === c.id ? 'selected' : ''}>${escapeHtml(c.name)}</option>`).join('');
  openModal(id ? 'Редактировать возражение' : 'Новое возражение', `
    <form class="form-grid" id="obj-form">
      <label><div class="lbl">Заголовок (что говорит клиент)</div>
        <input type="text" name="title" value="${escapeHtml(o.title)}" required></label>
      <label><div class="lbl">Текст ответа (поддерживает **жирный**, списки через -, переносы строк)</div>
        <textarea name="answer" required>${escapeHtml(o.answer)}</textarea></label>
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
  document.getElementById('obj-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const isGeneral = fd.get('is_general') === 'on';
    const payload = {
      title: fd.get('title'),
      answer: fd.get('answer'),
      is_general: isGeneral,
      category_id: isGeneral ? null : (fd.get('category_id') || null),
      keywords: fd.get('keywords') || '',
      sort_order: Number(fd.get('sort_order')) || 0,
      is_active: fd.get('is_active') === 'on',
    };
    const { error } = id
      ? await sb.from('objections').update(payload).eq('id', id)
      : await sb.from('objections').insert(payload);
    if (error) { toast('Ошибка: ' + error.message); return; }
    closeModal(); toast('Сохранено'); loadObjections();
  });
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
