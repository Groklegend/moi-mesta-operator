// ============================================================
// «Подключение компании» — пятишаговый мастер заявок (ТЗ Форма подключения)
// ============================================================
// Модуль работает только на seller.html (там есть #app-wizard).
// Состояние храним в одном объекте `state.app`. Любой ввод обновляет его и
// помечает форму как dirty. Сохранение в Supabase: ручное (кнопка) +
// автосейв через 30 сек после последней правки. Файлы — в Supabase Storage,
// бакет `application-files`, путь `<seller_id>/<application_id>/<filename>`.
// «Передать Гари» отправляет на Worker `/api/v1/applications/:id/submit`,
// который и зашлёт webhook сам.

(function () {
  if (!document.getElementById('app-wizard')) return;

  // ---------- Константы ----------

  const STEP_NAMES = ['О компании', 'Интеграция', 'Реквизиты', 'Контакты', 'Филиалы', 'Программа лояльности'];
  const TOTAL_STEPS = 6;
  const STORAGE_BUCKET = 'application-files';
  const MAX_FILE_SIZE = 5 * 1024 * 1024;
  // Преднастроенные системы для шага «Интеграция». Меняется здесь — UI обновляется автоматически.
  const INTEG_PRESETS = ['1С', 'iiko', 'R-Keeper', 'Эвотор'];

  // Поля по шагам — для записи в БД и для валидации.
  const STEP_FIELDS = {
    1: ['company_name', 'category_id', 'logo_urls', 'style_desc', 'short_desc'],
    2: ['integration'],
    3: ['inn', 'kpp', 'legal_name', 'ogrn', 'legal_address', 'signer_name',
        'signer_position', 'bank_account', 'bank_bik', 'bank_corr', 'bank_name'],
    4: ['website', 'telegram', 'max_channel', 'instagram', 'vk', 'customer_phone', 'email',
        'lpr_name', 'lpr_phone', 'marketer_name', 'marketer_phone'],
    5: ['branches'],
    6: ['loyalty'],
  };

  // Обязательные поля по ТЗ (звёздочка `*`).
  const REQUIRED = {
    1: ['company_name', 'category_id'],
    2: ['__integration__'],
    3: ['inn'],
    4: ['lpr_name', 'lpr_phone', 'email'],
    5: ['__branches__'],
    6: ['__loyalty__'],
  };

  const STATUS_LABELS = {
    draft:           { label: 'Черновик',       cls: 'muted',   badge: 'badge-draft' },
    new:             { label: 'Гари работает',  cls: 'success', badge: 'badge-working' },
    in_progress:     { label: 'Гари работает',  cls: 'success', badge: 'badge-working' },
    images_pending:  { label: 'Гари работает',  cls: 'success', badge: 'badge-working' },
    text_pending:    { label: 'Гари работает',  cls: 'success', badge: 'badge-working' },
    creating_cabinet:{ label: 'Гари работает',  cls: 'success', badge: 'badge-working' },
    ready:           { label: 'Готово',         cls: 'success', badge: 'badge-done' },
    launched:        { label: 'Запущено',       cls: 'success', badge: 'badge-done' },
  };

  const GARY_CHIP_LABELS = [
    'Проверяет данные',
    'Пишет текст',
    'Создаёт картинки',
    'На проверке',
    'Согласовывает',
    'Регистрирует',
    'На модерации',
  ];

  // Город для карточки сделки. Сначала смотрим явный city у первого филиала
  // (его проставляет DaData при выборе подсказки), иначе пытаемся выкусить
  // первый сегмент адреса вида «г Москва, ул …».
  function dealCity(deal) {
    const branches = Array.isArray(deal.branches) ? deal.branches : [];
    for (const b of branches) {
      if (b?.city) return b.city;
    }
    for (const b of branches) {
      const addr = (b?.address || '').trim();
      if (!addr) continue;
      const first = addr.split(',')[0].trim();
      const m = first.match(/^(?:г\.?|город|пгт\.?|с\.?|село|пос\.?|д\.?)\s+(.+)$/i);
      if (m) return m[1].trim();
      if (first && first.length < 40) return first;
    }
    return '';
  }

  function garyChipForDeal(deal) {
    if (!deal || !deal.id) return GARY_CHIP_LABELS[0];
    let h = 0;
    for (let i = 0; i < deal.id.length; i++) h = (h * 31 + deal.id.charCodeAt(i)) >>> 0;
    return GARY_CHIP_LABELS[h % GARY_CHIP_LABELS.length];
  }

  // Шаги Гари — маппинг DB-статуса на текущий шаг таймлайна
  const GARY_STEPS = [
    { id: 'checking',         label: 'Проверка данных',              icon: '📋', statuses: [] },
    { id: 'writing_text',     label: 'Подготовка текста',            icon: '💬', statuses: ['new'] },
    { id: 'creating_assets',  label: 'Создание материалов',          icon: '🎨', statuses: ['images_pending', 'text_pending'] },
    { id: 'internal_review',  label: 'Внутренняя проверка',          icon: '🔍', statuses: [] },
    { id: 'manager_approval', label: 'Согласование с менеджером',    icon: '🤝', statuses: [] },
    { id: 'registration',     label: 'Регистрация компании',         icon: '📝', statuses: ['in_progress', 'creating_cabinet'] },
    { id: 'moderation',       label: 'На модерации оператора',       icon: '📤', statuses: [] },
    { id: 'completed',        label: 'Компания запущена',            icon: '🎉', statuses: ['ready', 'launched'] },
  ];

  // ---------- Состояние ----------

  const state = {
    sellerId: null,
    categories: [], // [{id, name, icon}]
    app: emptyApp(), // текущая редактируемая заявка
    dirty: false,
    saving: false,
    autosaveTimer: null,
    currentStep: 1,
    visitedSteps: new Set([1]),
    // Режим «только просмотр»: открыли заявку со статусом не «draft».
    // Все поля заблокированы, кнопки сохранения/отправки скрыты.
    readOnly: false,
    // Для вкладки «Мои сделки»
    deals: [],
  };

  function emptyApp() {
    return {
      id: null,
      status: 'draft',
      company_name: '',
      category_id: '',
      logo_url: '',          // legacy — оставлено для обратной совместимости с заявками до миграции 17
      logo_urls: [],         // массив URL до 10 элементов (миграция 17)
      style_photos: [],      // legacy — стилевые фото убраны из UI, поле в БД остаётся
      style_desc: '',
      short_desc: '',
      full_desc: '',         // legacy — поле в БД остаётся для старых заявок
      inn: '', kpp: '', legal_name: '', ogrn: '', legal_address: '',
      signer_name: '', signer_position: '',
      bank_account: '', bank_bik: '', bank_corr: '', bank_name: '',
      website: '', telegram: '', max_channel: '', instagram: '', vk: '',
      customer_phone: '', email: '',
      lpr_name: '', lpr_phone: '', marketer_name: '', marketer_phone: '',
      email_verified: false, lpr_phone_verified: false,
      branches: [],
      loyalty: null,
      // Шаг 2 «Интеграция». Структура:
      //   { required: 'yes'|'no'|null, presets: { '1С': 'версия', ... },
      //     custom: [{name, version}], when: 'before_test'|'after_test'|null }
      // Если required != 'yes' — остальные поля игнорируются при отправке.
      integration: { required: null, presets: {}, custom: [], when: null },
    };
  }

  // ---------- Утилиты ----------

  function $(sel, root = document) { return root.querySelector(sel); }
  function $$(sel, root = document) { return Array.from(root.querySelectorAll(sel)); }

  function toast(msg, kind) {
    const t = $('#toast');
    if (!t) return;
    t.textContent = msg;
    t.classList.remove('hidden');
    if (kind === 'error') t.style.background = 'var(--danger)';
    else t.style.background = '';
    clearTimeout(toast._t);
    toast._t = setTimeout(() => t.classList.add('hidden'), 2200);
  }

  function showSavedFlag() {
    const el = $('#wiz-saved');
    if (!el) return;
    el.hidden = false;
    clearTimeout(showSavedFlag._t);
    showSavedFlag._t = setTimeout(() => { el.hidden = true; }, 1800);
  }

  // Кастомное модальное окно подтверждения. Возвращает Promise<boolean>:
  // true если пользователь нажал «ОК», false — «Отмена», Esc или клик вне окна.
  // Используется вместо стандартного confirm(), который рисуется браузером
  // и привязывается к домену (выглядит как системное предупреждение).
  function confirmDialog({ title, message, okText = 'Удалить', cancelText = 'Отмена', danger = false } = {}) {
    return new Promise((resolve) => {
      const backdrop = document.createElement('div');
      backdrop.className = 'modal-backdrop';
      backdrop.innerHTML = `
        <div class="modal-window" role="dialog" aria-modal="true">
          ${title ? `<h3 class="modal-title">${escapeHtml(title)}</h3>` : ''}
          ${message ? `<p class="modal-message">${escapeHtml(message)}</p>` : ''}
          <div class="modal-actions">
            ${cancelText ? `<button type="button" class="btn" data-act="cancel">${escapeHtml(cancelText)}</button>` : ''}
            <button type="button" class="btn ${danger ? 'danger' : 'primary'}" data-act="ok">${escapeHtml(okText)}</button>
          </div>
        </div>
      `;
      const close = (result) => {
        document.removeEventListener('keydown', onKey);
        backdrop.remove();
        resolve(result);
      };
      const onKey = (e) => {
        if (e.key === 'Escape') close(false);
        else if (e.key === 'Enter') close(true);
      };
      backdrop.addEventListener('click', (e) => {
        if (e.target === backdrop) close(false);
        const act = e.target.dataset?.act;
        if (act === 'ok') close(true);
        else if (act === 'cancel') close(false);
      });
      document.addEventListener('keydown', onKey);
      document.body.appendChild(backdrop);
      // Авто-фокус на «ОК», чтобы Enter сразу подтверждал.
      backdrop.querySelector('[data-act="ok"]')?.focus();
    });
  }

  function setDirty() {
    // В режиме «только просмотр» любые изменения в state — баг или
    // случайный обработчик. Не пишем в БД, не запускаем автосейв.
    if (state.readOnly) return;
    state.dirty = true;
    mirrorToLocal();
    clearTimeout(state.autosaveTimer);
    // 2 секунды — компромисс: успеваем «дать допечатать», но рефреш через
    // 5 секунд уже не теряет данные на сервере. В localStorage всё
    // сохранено мгновенно, см. mirrorToLocal().
    state.autosaveTimer = setTimeout(() => saveDraft({ silent: true }), 2_000);
    updateNextEnabled();
  }

  // ---------- localStorage-зеркало ----------
  // На каждое изменение копируем state.app в localStorage. Если пользователь
  // обновит страницу до того, как сработал автосейв в БД (или вообще
  // потеряет связь с интернетом) — данные не пропадут: при следующем
  // открытии формы предложим восстановить из локальной копии.

  const LS_KEY_NEW = 'seller-app-draft:new';
  const LS_KEY_EDIT = (id) => `seller-app-draft:${id}`;

  function lsKey() {
    return state.app.id ? LS_KEY_EDIT(state.app.id) : LS_KEY_NEW;
  }

  function mirrorToLocal() {
    try {
      const payload = { app: state.app, mirroredAt: Date.now() };
      localStorage.setItem(lsKey(), JSON.stringify(payload));
    } catch (_) { /* приватный режим / квота — не критично */ }
  }

  function clearLocalMirror(id) {
    try {
      localStorage.removeItem(id ? LS_KEY_EDIT(id) : LS_KEY_NEW);
    } catch (_) {}
  }

  function readLocalMirror(key) {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return null;
      const obj = JSON.parse(raw);
      if (!obj || !obj.app || typeof obj.app !== 'object') return null;
      return obj;
    } catch (_) { return null; }
  }

  // Есть ли в локальной копии хоть какие-то осмысленные данные? (Чтобы не
  // спрашивать «восстановить?», когда user просто кликнул в форму и сразу
  // обновил страницу.)
  function hasMeaningfulDraftData(app) {
    if (!app) return false;
    const SIGNAL = ['company_name', 'inn', 'legal_name', 'lpr_name',
                    'lpr_phone', 'short_desc', 'full_desc'];
    if (SIGNAL.some(f => (app[f] || '').toString().trim().length > 0)) return true;
    if (Array.isArray(app.branches) && app.branches.length > 0) return true;
    return false;
  }

  function isInnValid(v) {
    const s = String(v || '').replace(/\D/g, '');
    return s.length === 10 || s.length === 12;
  }

  function isPhoneValid(v) {
    // Полный российский номер — ровно 11 цифр (код страны + 10 цифр).
    // Раньше была проверка >= 10, но при ней «7 (342) 342 35 4» (10 цифр)
    // считалось валидным и кнопка «Далее» оставалась активной.
    const s = String(v || '').replace(/\D/g, '');
    return s.length === 11;
  }

  // Минимально достаточная проверка адреса электронной почты:
  // что-то@что-то.что-то — без излишне строгого RFC-5322.
  function isEmailValid(v) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(v || '').trim());
  }

  // Форматирование российского номера: «7 (927) 325 24 25».
  // Если введено меньше 11 цифр — рисуем столько, сколько уже есть.
  // Если первая цифра не 7 и не 8 — считаем, что юзер опустил код страны
  // и подставляем 7 (10-значные «9XXXXXXXXX» → «7 (9XX) XXX XX XX»).
  function formatPhone(raw) {
    let d = String(raw || '').replace(/\D/g, '');
    if (!d) return '';
    if (d[0] !== '7' && d[0] !== '8') d = '7' + d;
    d = d.slice(0, 11);
    let out = d[0];
    if (d.length > 1) out += ' (' + d.slice(1, Math.min(4, d.length));
    if (d.length >= 4) out += ')';
    if (d.length > 4) out += ' ' + d.slice(4, Math.min(7, d.length));
    if (d.length > 7) out += ' ' + d.slice(7, Math.min(9, d.length));
    if (d.length > 9) out += ' ' + d.slice(9, 11);
    return out;
  }

  // Привязываем авто-форматирование к полю телефона. Каретку держим на той
  // же позиции по числу цифр (а не символов), чтобы после вставки скобки
  // не прыгала туда-сюда.
  function bindPhoneFormat(inp) {
    if (!inp || inp._phoneWired) return;
    inp._phoneWired = true;
    const reformat = () => {
      const before = inp.value.slice(0, inp.selectionStart || 0);
      const digitsBefore = (before.match(/\d/g) || []).length;
      const formatted = formatPhone(inp.value);
      if (formatted === inp.value) return;
      inp.value = formatted;
      let pos = formatted.length;
      let count = 0;
      for (let i = 0; i < formatted.length; i++) {
        if (/\d/.test(formatted[i])) count++;
        if (count === digitsBefore) { pos = i + 1; break; }
      }
      try { inp.setSelectionRange(pos, pos); } catch (_) { /* старые браузеры */ }
    };
    inp.addEventListener('input', reformat);
    inp.addEventListener('blur', () => { inp.value = formatPhone(inp.value); });
    if (inp.value) inp.value = formatPhone(inp.value);
  }

  // ---------- Категории ----------

  async function loadCategories() {
    const { data, error } = await sb.from('categories')
      .select('id, name, icon, sort_order')
      .order('sort_order', { ascending: true });
    if (error) { console.warn('categories:', error.message); return; }
    state.categories = data || [];
    const sel = $('#wiz-category');
    if (sel) {
      sel.innerHTML = '<option value="">— выберите —</option>' +
        state.categories.map(c => `<option value="${c.id}">${(c.icon||'')} ${escapeHtml(c.name)}</option>`).join('');
    }
  }

  // ---------- Загрузка/сохранение заявки ----------

  async function startNewApplication() {
    state.app = emptyApp();
    state.app.seller_id = state.sellerId;
    state.dirty = false;
    state.readOnly = false;
    state.currentStep = 1;
    state.visitedSteps = new Set([1]);

    // Если в localStorage остался незавершённый «новый» черновик —
    // предлагаем восстановить.
    const local = readLocalMirror(LS_KEY_NEW);
    if (local && hasMeaningfulDraftData(local.app)) {
      const ts = new Date(local.mirroredAt).toLocaleString('ru-RU');
      const ok = await confirmDialog({
        title: 'Найдена незавершённая заявка',
        message: `От ${ts} остались несохранённые данные. Восстановить?`,
        okText: 'Восстановить',
        cancelText: 'Начать заново',
      });
      if (ok) {
        state.app = { ...emptyApp(), ...local.app };
        state.app.id = null; // мирор может быть «грязный», id не доверяем
        state.app.seller_id = state.sellerId;
        state.dirty = true;  // отметим — пусть автосейв уйдёт в БД
        // Открываем первый незаполненный шаг.
        let resumeAt = TOTAL_STEPS;
        for (let s = 1; s <= TOTAL_STEPS; s++) {
          if (!isStepValid(s)) { resumeAt = s; break; }
        }
        state.currentStep = resumeAt;
        state.visitedSteps = new Set([1, 2, 3, 4, 5]);
      } else {
        clearLocalMirror(); // отказались — больше не предлагаем
      }
    }

    renderAll();
    showWizard();
    // После восстановления — ускоренный сейв в БД, не ждём 2 секунды.
    if (state.dirty) {
      clearTimeout(state.autosaveTimer);
      state.autosaveTimer = setTimeout(() => saveDraft({ silent: true }), 300);
    }
  }

  async function loadApplication(id) {
    const { data, error } = await sb.from('applications')
      .select('*').eq('id', id).maybeSingle();
    if (error || !data) {
      toast('Не удалось открыть заявку', 'error');
      return;
    }
    state.app = { ...emptyApp(), ...data };
    if (!Array.isArray(state.app.branches)) state.app.branches = [];
    if (!Array.isArray(state.app.style_photos)) state.app.style_photos = [];
    state.dirty = false;
    // Заявку, отправленную Гари (или дальше по пайплайну), редактировать
    // нельзя — открываем в режиме просмотра.
    state.readOnly = !!state.app.status && state.app.status !== 'draft';
    // Открываем первый незаполненный шаг — чтобы при «Продолжить» из списка
    // черновиков сразу попасть туда, где осталась работа. Если все шаги
    // валидны, останавливаемся на последнем (там кнопка «Передать Гари»).
    let resumeAt = TOTAL_STEPS;
    for (let s = 1; s <= TOTAL_STEPS; s++) {
      if (!isStepValid(s)) { resumeAt = s; break; }
    }
    state.currentStep = resumeAt;
    state.visitedSteps = new Set([1, 2, 3, 4, 5]); // открыли — все шаги уже «посещены»

    // Если в localStorage есть копия этой же заявки, более свежая, чем БД —
    // предложим восстановить (рефреш до того, как дёрнулся автосейв в БД).
    // В режиме просмотра не предлагаем — заявка уже передана, изменения
    // всё равно не сохранятся.
    const local = state.readOnly ? null : readLocalMirror(LS_KEY_EDIT(id));
    const dbTs = data.updated_at ? new Date(data.updated_at).getTime() : 0;
    if (local && local.mirroredAt > dbTs + 1500 && hasMeaningfulDraftData(local.app)) {
      const ts = new Date(local.mirroredAt).toLocaleString('ru-RU');
      const ok = await confirmDialog({
        title: 'Найдены несохранённые изменения',
        message: `От ${ts} в этой заявке есть правки, которые не успели уйти в базу. Восстановить их?`,
        okText: 'Восстановить',
        cancelText: 'Игнорировать',
      });
      if (ok) {
        state.app = { ...emptyApp(), ...local.app, id }; // id берём из БД
        if (!Array.isArray(state.app.branches)) state.app.branches = [];
        if (!Array.isArray(state.app.style_photos)) state.app.style_photos = [];
        state.dirty = true; // пусть автосейв унесёт в БД
      } else {
        clearLocalMirror(id);
      }
    }

    renderAll();
    showWizard();
    if (state.dirty) {
      clearTimeout(state.autosaveTimer);
      state.autosaveTimer = setTimeout(() => saveDraft({ silent: true }), 300);
    }
  }

  async function saveDraft({ silent } = {}) {
    if (state.saving) return;
    if (!state.dirty && state.app.id) {
      if (!silent) toast('Нет изменений');
      return state.app;
    }
    state.saving = true;
    const btn = $('#wiz-save-draft');
    if (btn) { btn.disabled = true; btn.textContent = 'Сохраняем…'; }

    const payload = serializeApp();
    let result;
    if (!state.app.id) {
      // INSERT
      payload.seller_id = state.sellerId;
      payload.status = state.app.status || 'draft';
      const { data, error } = await sb.from('applications').insert(payload).select().single();
      result = { data, error };
    } else {
      // UPDATE
      const { data, error } = await sb.from('applications')
        .update(payload).eq('id', state.app.id).select().single();
      result = { data, error };
    }

    state.saving = false;
    if (btn) { btn.disabled = false; btn.textContent = '💾 Сохранить'; }

    if (result.error) {
      toast('Ошибка сохранения: ' + result.error.message, 'error');
      console.error(result.error);
      return null;
    }
    const wasNew = !state.app.id;
    state.app.id = result.data.id;
    state.app.status = result.data.status;
    state.dirty = false;
    // БД теперь авторитетна для текущего id — чистим локальный мирор.
    // Если это был INSERT, ещё чистим ключ «новой» заявки.
    if (wasNew) clearLocalMirror();
    clearLocalMirror(state.app.id);
    // После первого сохранения подменяем хеш на «#app:<id>». Это нужно,
    // чтобы рефреш страницы прямо из формы вернул пользователя ровно
    // в эту же заявку, а не в общий список (мы не теряем контекст).
    if (wasNew && state.app.id) {
      try { history.replaceState(null, '', '#app:' + state.app.id); } catch (_) {}
    }
    showSavedFlag();
    if (!silent) toast('Сохранено');
    if (window.audit) window.audit.log({
      action: 'application_save_draft',
      target_type: 'application',
      target_id: state.app.id,
    });
    return result.data;
  }

  function serializeApp() {
    const out = {};
    for (const f of [
      'company_name', 'category_id', 'logo_url', 'style_desc',
      'short_desc', 'full_desc',
      'inn', 'kpp', 'legal_name', 'ogrn', 'legal_address',
      'signer_name', 'signer_position',
      'bank_account', 'bank_bik', 'bank_corr', 'bank_name',
      'website', 'telegram', 'max_channel', 'instagram', 'vk',
      'customer_phone', 'email', 'lpr_name', 'lpr_phone', 'marketer_name', 'marketer_phone',
    ]) {
      out[f] = (state.app[f] === '' || state.app[f] === undefined) ? null : state.app[f];
    }
    out.style_photos = state.app.style_photos || [];
    out.logo_urls = state.app.logo_urls || [];
    out.branches = state.app.branches || [];
    out.loyalty = state.app.loyalty || null;
    out.integration = state.app.integration || { required: null, presets: {}, custom: [], when: null };
    return out;
  }

  // ---------- Валидация шагов ----------

  // Человекочитаемые названия полей — для подсказок «Заполните «X»».
  const FIELD_LABELS = {
    company_name: 'Название компании',
    category_id: 'Рубрика',
    inn: 'ИНН',
    lpr_name: 'ФИО ЛПР (собственника)',
    lpr_phone: 'Телефон ЛПР',
    email: 'E-mail',
  };

  // Возвращает {errors, fields}: errors — человекочитаемые тексты,
  // fields — id полей в state.app (для подсветки красной рамкой).
  function getStepIssues(step) {
    const errors = [];
    const fields = [];
    for (const f of (REQUIRED[step] || [])) {
      if (f === '__branches__') {
        if (!state.app.branches || state.app.branches.length === 0)
          errors.push('Добавьте хотя бы один филиал');
        else if (state.app.branches.some(b => !b.address || !b.address.trim()))
          errors.push('У всех филиалов должен быть заполнен адрес');
        continue;
      }
      if (f === '__integration__') {
        const ig = state.app.integration || {};
        if (ig.required !== 'yes' && ig.required !== 'no') {
          errors.push('Укажите, требуется ли интеграция');
          continue;
        }
        if (ig.required === 'no') continue; // больше нечего проверять
        const presetCount = Object.keys(ig.presets || {}).length;
        const customCount = (ig.custom || []).filter(s => s && s.name && s.name.trim()).length;
        if (presetCount + customCount === 0) {
          errors.push('Выберите хотя бы одну систему для интеграции');
        }
        if (ig.when !== 'before_test' && ig.when !== 'after_test') {
          errors.push('Укажите, когда нужна интеграция (до или после тестового периода)');
        }
        continue;
      }
      if (f === '__loyalty__') {
        const l = state.app.loyalty;
        if (!l || !l.type) {
          errors.push('Выберите тип программы лояльности');
          continue;
        }
        if (l.type === 'external') {
          continue; // для внешней программы остальные проверки не нужны
        }
        if (!l.subtype) {
          errors.push('Выберите подтип программы');
          continue;
        }
        // Нужно сдвинуть хотя бы один процент. Иначе значит пользователь
        // ничего не настраивал — и программа не имеет смысла.
        const PCT_KEYS = ['accrual_percent', 'payment_percent', 'discount_percent', 'start_percent'];
        const anyPercent = PCT_KEYS.some(k => Number(l[k]) > 0);
        const hasTiers = (Array.isArray(l.tiers) && l.tiers.some(t => Number(t.percent) > 0))
                      || (Array.isArray(l.monthly_tiers) && l.monthly_tiers.some(t => Number(t.percent) > 0));
        if (!anyPercent && !hasTiers) {
          errors.push(l.type === 'bonus'
            ? 'Укажите процент бонусов (хотя бы один из ползунков сдвиньте больше 0)'
            : 'Укажите процент скидки (сдвиньте ползунок больше 0)');
        }
        continue;
      }
      const v = state.app[f];
      if (v === null || v === undefined || String(v).trim() === '') {
        const label = FIELD_LABELS[f] || f;
        errors.push(`Заполните «${label}»`);
        fields.push(f);
      }
    }
    if (step === 3 && state.app.inn && !isInnValid(state.app.inn)) {
      errors.push('ИНН должен содержать 10 или 12 цифр');
      fields.push('inn');
    }
    if (step === 4) {
      if (state.app.lpr_phone && !isPhoneValid(state.app.lpr_phone)) {
        errors.push('Заполните телефон ЛПР полностью (11 цифр)');
        fields.push('lpr_phone');
      }
      if (state.app.customer_phone && !isPhoneValid(state.app.customer_phone)) {
        errors.push('Заполните телефон для покупателей полностью (11 цифр)');
        fields.push('customer_phone');
      }
      if (state.app.marketer_phone && !isPhoneValid(state.app.marketer_phone)) {
        errors.push('Заполните телефон маркетолога полностью (11 цифр)');
        fields.push('marketer_phone');
      }
      if (state.app.email && !isEmailValid(state.app.email)) {
        errors.push('Проверьте e-mail');
        fields.push('email');
      }
    }
    return { errors, fields };
  }

  // Старая обёртка — используется в paseHandlers, isStepValid и пр.
  function validateStep(step) { return getStepIssues(step).errors; }

  function isStepValid(step) {
    return validateStep(step).length === 0;
  }

  // Подсветить красной рамкой пустые / невалидные поля. Класс снимается
  // при следующем вводе в это поле.
  function highlightInvalidFields(fieldNames) {
    fieldNames.forEach(f => {
      const inp = document.querySelector(`#app-wizard [data-f="${f}"]`);
      if (!inp) return;
      inp.classList.add('field-error');
      const onInput = () => {
        inp.classList.remove('field-error');
        inp.removeEventListener('input', onInput);
      };
      inp.addEventListener('input', onInput);
    });
  }

  function updateNextEnabled() {
    const next = $('#wiz-next');
    if (!next) return;
    // Кнопку больше не делаем disabled — пусть пользователь всегда может
    // её нажать. Если шаг не валиден, по клику покажем модалку с тем,
    // что нужно дозаполнить, а при наведении — всплывающую подсказку.
    next.disabled = false;
    if (state.readOnly) {
      next.textContent = 'Далее →';
      next.classList.remove('submit', 'not-ready');
      return;
    }
    if (state.currentStep === TOTAL_STEPS) {
      next.textContent = 'Передать Гари';
      next.classList.add('submit');
    } else {
      next.textContent = 'Далее →';
      next.classList.remove('submit');
    }
    // Помечаем «не готова» — слегка приглушённый стиль (оформляется в CSS).
    next.classList.toggle('not-ready', !isStepValid(state.currentStep));
  }

  // ---------- Шаги: рендер ----------

  function renderAll() {
    renderSteps();
    renderPanes();
    bindFieldInputs();
    renderIntegration();
    renderBranches();
    renderLoyalty();
    updateNextEnabled();
    applyReadOnlyMode();
  }

  // Применяем режим «только просмотр» для отправленных заявок.
  // Поля становятся readonly, кнопки сохранения/отправки/добавления —
  // скрыты, чтобы пользователь не мог изменить и тем более переотправить.
  function applyReadOnlyMode() {
    const wiz = $('#app-wizard');
    if (!wiz) return;
    wiz.classList.toggle('is-readonly', !!state.readOnly);

    // Все простые поля.
    $$('#app-wizard input, #app-wizard textarea, #app-wizard select').forEach(el => {
      if (state.readOnly) {
        if (el.type === 'checkbox' || el.type === 'radio' || el.type === 'file' || el.tagName === 'SELECT') {
          el.disabled = true;
        } else {
          el.readOnly = true;
        }
      } else {
        if (el.type === 'checkbox' || el.type === 'radio' || el.type === 'file' || el.tagName === 'SELECT') {
          el.disabled = false;
        } else {
          el.readOnly = false;
        }
      }
    });

    // Кнопки, которые в режиме просмотра не нужны.
    const HIDE_IDS = [
      '#wiz-save-draft', '#wiz-save-draft-2',
      '#wiz-add-branch', '#wiz-card-pick',
      '#wiz-inn-fetch', '#wiz-bik-fetch',
      '#wiz-email-action', '#wiz-lpr-phone-action',
      '#wiz-email-resend', '#wiz-lpr-phone-resend',
      '#wiz-logo-pick',
      '#wiz-loyalty-help', '#wiz-loyalty-help-banner',
    ];
    HIDE_IDS.forEach(sel => {
      const el = $(sel);
      if (el) el.hidden = state.readOnly && !el.classList.contains('keep-in-readonly');
    });
    // Кнопка «Далее» в режиме просмотра — оставляем как навигатор по шагам.
    // На последнем шаге её скрываем (оранжевой кнопки «Передать Гари»
    // у уже отправленной заявки быть не должно).
    const next = $('#wiz-next');
    if (next) {
      next.hidden = state.readOnly && state.currentStep === TOTAL_STEPS;
      next.classList.toggle('not-ready', false);
    }

    // Кнопки внутри блоков (пороги, филиалы, сегментированные кнопки и т.п.).
    $$('#app-wizard .tier-add, #app-wizard .tier-del, #app-wizard .branch-del, #app-wizard .seg-btn:not(.active), #app-wizard .subtype-tab:not(.active)').forEach(b => {
      b.hidden = !!state.readOnly;
    });
    // А неактивные радио-карточки типов программы — приглушаем (но кликать
    // нельзя, потому что input[type=radio] выше получил disabled).
  }

  function renderSteps() {
    $$('#wiz-steps .wiz-step').forEach(li => {
      const step = Number(li.dataset.step);
      li.classList.toggle('active', step === state.currentStep);
      // Зелёная галочка ставится только когда все обязательные поля шага
      // заполнены (isStepValid). Не привязано к посещению — пользователь
      // может прыгать в любой последовательности, шаг подсветится зелёным
      // ровно тогда, когда там действительно всё в порядке.
      // В режиме просмотра — все шаги done (заявка уже отправлена).
      // Текущий шаг не помечаем как done — он подсвечен оранжевым через .active.
      const done = state.readOnly
        ? true
        : (step !== state.currentStep && isStepValid(step));
      li.classList.toggle('done', done);
      // Все шаги всегда кликабельны — пользователь заполняет в любой
      // последовательности, валидация происходит только при «Передать Гари».
      li.classList.add('clickable');
    });
  }

  function renderPanes() {
    $$('#app-wizard .wiz-pane').forEach(p => {
      p.hidden = Number(p.dataset.pane) !== state.currentStep;
    });
    const prev = $('#wiz-prev');
    if (prev) prev.hidden = state.currentStep === 1;
    const sub = $('#wiz-sub');
    if (sub) {
      const base = `Шаг ${state.currentStep} из ${TOTAL_STEPS}: ${STEP_NAMES[state.currentStep-1]}`;
      sub.textContent = state.readOnly
        ? `${base} · режим просмотра (редактирование запрещено)`
        : base;
    }
  }

  // Прописываем значения из state в DOM-инпуты (для всех простых полей).
  function bindFieldInputs() {
    const PHONE_FIELDS = new Set(['customer_phone', 'lpr_phone', 'marketer_phone']);
    $$('#app-wizard [data-f]').forEach(inp => {
      const f = inp.dataset.f;
      const v = state.app[f] ?? '';
      inp.value = v == null ? '' : v;
      if (PHONE_FIELDS.has(f)) {
        bindPhoneFormat(inp);
      }
      // На input — обновляем state и помечаем dirty.
      if (!inp._wired) {
        inp._wired = true;
        inp.addEventListener('input', () => {
          state.app[f] = inp.value;
          setDirty();
          if (f === 'short_desc' || f === 'company_name' || f === 'category_id') {
            updateNextEnabled();
          }
          if (f === 'lpr_phone') updateNextEnabled();
        });
        inp.addEventListener('change', () => {
          state.app[f] = inp.value;
          setDirty();
          updateNextEnabled();
        });
      }
    });
  }

  // ---------- Шаг 1: файлы ----------

  const LOGO_MAX = 10;

  // Возвращает актуальный массив URL логотипов. Если в legacy-поле logo_url
  // что-то есть, а в logo_urls пусто — миграция на лету.
  function getLogoUrls() {
    if (!Array.isArray(state.app.logo_urls)) state.app.logo_urls = [];
    if (state.app.logo_urls.length === 0 && state.app.logo_url) {
      state.app.logo_urls = [state.app.logo_url];
    }
    return state.app.logo_urls;
  }

  function bindFileInputs() {
    const logoPick = $('#wiz-logo-pick');
    const logoInp = $('#wiz-logo-input');
    if (logoPick && !logoPick._wired) {
      logoPick._wired = true;
      logoPick.addEventListener('click', () => logoInp.click());
      logoInp.addEventListener('change', async (e) => {
        const files = Array.from(e.target.files || []);
        for (const f of files) {
          const list = getLogoUrls();
          if (list.length >= LOGO_MAX) {
            toast(`Максимум ${LOGO_MAX} файлов`, 'error');
            break;
          }
          await uploadLogo(f);
        }
        e.target.value = '';
      });
    }
    renderLogoGallery();
  }

  function renderLogoGallery() {
    const grid = $('#wiz-logo-grid');
    const count = $('#wiz-logo-count');
    const pickBtn = $('#wiz-logo-pick');
    if (!grid) return;
    const urls = getLogoUrls();

    grid.innerHTML = urls.map((url, i) => `
      <div class="file-thumb">
        <img src="${escapeHtml(url)}" alt="logo ${i + 1}">
        <button type="button" class="file-remove" data-idx="${i}" title="Удалить">×</button>
      </div>`).join('');
    grid.querySelectorAll('.file-remove').forEach(btn => {
      btn.addEventListener('click', () => {
        const i = Number(btn.dataset.idx);
        state.app.logo_urls.splice(i, 1);
        // Синхронизируем legacy-поле с первым элементом, чтобы не зависало старое значение.
        state.app.logo_url = state.app.logo_urls[0] || '';
        setDirty();
        renderLogoGallery();
      });
    });

    if (count) count.textContent = `${urls.length} / ${LOGO_MAX}`;
    if (pickBtn) pickBtn.disabled = urls.length >= LOGO_MAX || !!state.readOnly;
  }

  async function uploadLogo(file) {
    const url = await uploadFile(file, 'logo');
    if (url) {
      const list = getLogoUrls();
      list.push(url);
      // Обновляем legacy-поле для обратной совместимости с Гари / админкой.
      state.app.logo_url = list[0];
      setDirty();
      renderLogoGallery();
    }
  }

  async function uploadFile(file, prefix) {
    if (!file) return null;
    if (file.size > MAX_FILE_SIZE) {
      toast('Файл больше 5 МБ', 'error');
      return null;
    }
    if (!/^image\/(jpeg|png|webp)$/.test(file.type)) {
      toast('Только JPG, PNG или WEBP', 'error');
      return null;
    }
    // Если ещё нет id — сначала сохраняем черновик, чтобы получить id.
    if (!state.app.id) {
      const saved = await saveDraft({ silent: true });
      if (!saved) { toast('Сначала заполните название', 'error'); return null; }
    }
    const ext = (file.name.split('.').pop() || 'jpg').toLowerCase();
    const path = `${state.sellerId}/${state.app.id}/${prefix}-${Date.now()}.${ext}`;
    const { error } = await sb.storage.from(STORAGE_BUCKET).upload(path, file, {
      cacheControl: '3600', upsert: false, contentType: file.type,
    });
    if (error) { toast('Ошибка загрузки: ' + error.message, 'error'); return null; }
    const { data: pub } = sb.storage.from(STORAGE_BUCKET).getPublicUrl(path);
    return pub.publicUrl;
  }

  // ---------- Шаг 2: Загрузка карточки предприятия ----------
  //
  // Поддержка трёх форматов:
  //   .txt  — читаем напрямую через FileReader.
  //   .docx — через mammoth.js (lazy-load с CDN, ~150 КБ).
  //   .pdf  — через pdf.js (lazy-load с CDN). Сканы PDF без текстового
  //           слоя распознать не сможем — об этом пишем в статусе.
  // После извлечения текста бьём по нему регулярками: ИНН/КПП/ОГРН/
  // р.счёт/БИК/корр.счёт/банк/юр.адрес/подписант. Если в файле есть ИНН —
  // параллельно дёргаем DaData (получим официальное название и ОГРН).
  // Карточка перекрывает банковские поля, которых в DaData нет.

  function setCardStatus(html, kind) {
    const el = $('#wiz-card-status');
    if (!el) return;
    el.hidden = !html;
    el.className = 'card-upload-status' + (kind ? ' ' + kind : '');
    el.innerHTML = html || '';
  }

  function loadScriptOnce(url) {
    return new Promise((resolve, reject) => {
      if (loadScriptOnce._cache?.[url]) return resolve();
      loadScriptOnce._cache = loadScriptOnce._cache || {};
      const s = document.createElement('script');
      s.src = url; s.async = true;
      s.onload = () => { loadScriptOnce._cache[url] = true; resolve(); };
      s.onerror = () => reject(new Error('Не удалось загрузить ' + url));
      document.head.appendChild(s);
    });
  }

  async function readFileAsText(file) {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result || ''));
      r.onerror = () => reject(r.error);
      r.readAsText(file, 'utf-8');
    });
  }

  async function readFileAsArrayBuffer(file) {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result);
      r.onerror = () => reject(r.error);
      r.readAsArrayBuffer(file);
    });
  }

  async function extractTextFromDocx(file) {
    await loadScriptOnce('https://cdn.jsdelivr.net/npm/mammoth@1.7.2/mammoth.browser.min.js');
    if (typeof window.mammoth === 'undefined') throw new Error('mammoth не подгрузился');
    const buf = await readFileAsArrayBuffer(file);
    const res = await window.mammoth.extractRawText({ arrayBuffer: buf });
    return res.value || '';
  }

  async function extractTextFromPdf(file) {
    // pdf.js v4 — ESM; используем legacy build, который работает как обычный <script>.
    const PDFJS_VERSION = '3.11.174';
    await loadScriptOnce(`https://cdn.jsdelivr.net/npm/pdfjs-dist@${PDFJS_VERSION}/legacy/build/pdf.min.js`);
    if (typeof window.pdfjsLib === 'undefined') throw new Error('pdf.js не подгрузился');
    window.pdfjsLib.GlobalWorkerOptions.workerSrc =
      `https://cdn.jsdelivr.net/npm/pdfjs-dist@${PDFJS_VERSION}/legacy/build/pdf.worker.min.js`;
    const buf = await readFileAsArrayBuffer(file);
    const doc = await window.pdfjsLib.getDocument({ data: buf }).promise;
    let text = '';
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i);
      const content = await page.getTextContent();
      text += content.items.map(it => it.str || '').join(' ') + '\n';
    }
    return text;
  }

  async function extractTextFromFile(file) {
    const name = (file.name || '').toLowerCase();
    if (name.endsWith('.txt') || file.type === 'text/plain') return readFileAsText(file);
    if (name.endsWith('.docx') || file.type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') return extractTextFromDocx(file);
    if (name.endsWith('.pdf') || file.type === 'application/pdf') return extractTextFromPdf(file);
    throw new Error('Поддерживаются только .docx, .pdf, .txt');
  }

  // Парсер русских реквизитов: после ключевого слова разрешаем до 30
  // не-цифровых символов (двоеточия, /, -, пробелы) и забираем нужное
  // количество цифр. Для адреса/банка/ФИО — отдельные правила.
  function parseCompanyCard(text) {
    const t = String(text || '').replace(/\r\n?/g, '\n').replace(/ /g, ' ');
    const out = {};
    const cleanDigits = s => (s || '').replace(/\D/g, '');
    const grab = (re) => { const m = t.match(re); return m ? m[1] : null; };

    // ИНН: 12 (ИП) пробуем первым, потом 10 (ЮЛ) — иначе для 12-значного ИНН
    // могло бы захватиться только 10 цифр. \b не работает с кириллицей в JS,
    // поэтому word-boundary не используем.
    const inn12 = grab(/ИНН\D{0,30}?(\d{12})(?!\d)/i);
    const inn10 = grab(/ИНН\D{0,30}?(\d{10})(?!\d)/i);
    if (inn12) out.inn = cleanDigits(inn12);
    else if (inn10) out.inn = cleanDigits(inn10);

    // КПП — ровно 9 цифр. Допускаем пропуск через любые символы (в т.ч. цифры
    // ИНН в связке «ИНН/КПП: 5501133850 / 550101001»). Якорим по
    // не-цифрам с двух сторон, чтобы не зацепить часть длинного числа.
    const kpp = grab(/КПП[\s\S]{0,40}?(?<!\d)(\d{9})(?!\d)/i);
    if (kpp) out.kpp = cleanDigits(kpp);

    // ОГРНИП (15) — пробуем первым; иначе ОГРН (13). С lookahead.
    const ogrnip = grab(/ОГРНИП\D{0,30}?(\d{15})(?!\d)/i);
    const ogrn = grab(/ОГРН(?!ИП)\D{0,30}?(\d{13})(?!\d)/i);
    if (ogrnip) out.ogrn = cleanDigits(ogrnip);
    else if (ogrn) out.ogrn = cleanDigits(ogrn);

    // Юр. адрес — берём остаток строки.
    const addrM = t.match(/(?:^|\n)\s*(?:Юридический\s+адрес|Юр\.?\s*адрес|Адрес\s+регистрации|Местонахождение)\s*[:\-—]?\s*([^\n]+)/i);
    if (addrM) out.legal_address = addrM[1].trim().replace(/[;,]\s*$/, '');

    // ФИО подписанта + должность.
    const POSITIONS = '(Генеральный\\s+директор|Директор|Руководитель|Управляющий|Президент|Председатель\\s+правления|Индивидуальный\\s+предприниматель|ИП)';
    // 1) Полное ФИО (Фамилия Имя Отчество).
    let signerM = t.match(new RegExp(`(?:^|\\n|\\s)${POSITIONS}\\s*[:\\-—]?\\s*([А-ЯЁ][а-яё\\-]+\\s+[А-ЯЁ][а-яё\\-]+\\s+[А-ЯЁ][а-яё\\-]+)`));
    // 2) Иначе фамилия + инициалы (Иванов И.И.).
    if (!signerM) {
      signerM = t.match(new RegExp(`(?:^|\\n|\\s)${POSITIONS}\\s*[:\\-—]?\\s*([А-ЯЁ][а-яё\\-]+\\s+[А-ЯЁ]\\.?\\s*[А-ЯЁ]?\\.?)`));
    }
    if (signerM) {
      out.signer_position = signerM[1].trim().replace(/^ИП$/i, 'Индивидуальный предприниматель');
      out.signer_name = signerM[2].trim().replace(/\s+/g, ' ');
    }

    // Все 20-значные блоки в тексте — пригодятся для классификации счётов.
    // В табличных карточках предприятия метки («Расчётный счёт», «Корр. счёт»,
    // «БИК») идут в одной строке, а значения — в следующей; обычные регулярки
    // «метка → значение рядом» в этом случае не работают, поэтому
    // классифицируем по префиксу: корр. счёт всегда начинается с 301,
    // расчётный — с 4xx/5xx.
    const allAccounts = [];
    {
      const re = /(?<!\d)((?:\d[\s.\-]*){20})(?!\d)/g;
      let m;
      while ((m = re.exec(t)) !== null) {
        const d = cleanDigits(m[1]);
        if (d.length === 20 && !allAccounts.includes(d)) allAccounts.push(d);
      }
    }
    const corrAcc = allAccounts.find(a => a.startsWith('301'));
    const opAcc = allAccounts.find(a => a !== corrAcc);
    if (opAcc) out.bank_account = opAcc;
    if (corrAcc) out.bank_corr = corrAcc;

    // Фолбэк по меткам — на случай редких карточек, где счёт не начинается с 4xx.
    if (!out.bank_account) {
      const accM = t.match(/(?:Р\/?[сc][^а-яё]|Расч[её]тный\s+сч[её]т|расч\.\s*счет)\D{0,15}?((?:\d[\s.\-]*){20})/i);
      if (accM) {
        const d = cleanDigits(accM[1]);
        if (d.length === 20) out.bank_account = d;
      }
    }
    if (!out.bank_corr) {
      const corrM = t.match(/(?:К\/?[сc][^а-яё]|Корр(?:еспондентский)?\.?\s*сч[её]т|корр\.\s*счет)\D{0,15}?((?:\d[\s.\-]*){20})/i);
      if (corrM) {
        const d = cleanDigits(corrM[1]);
        if (d.length === 20) out.bank_corr = d;
      }
    }

    // БИК — ровно 9 цифр. Сначала пытаемся «БИК <9 цифр>» подряд. Иначе
    // ищем любое отдельно стоящее 9-значное число, исключая совпадение с
    // уже найденным КПП (та же длина — но КПП мы зафиксировали выше).
    // Российские БИК всегда начинаются с «04», поэтому при множестве
    // кандидатов отдаём предпочтение им.
    let bik = grab(/БИК\D{0,30}?(\d{9})(?!\d)/i);
    if (!bik) {
      const candidates = [];
      const re = /(?<!\d)(\d{9})(?!\d)/g;
      let m;
      while ((m = re.exec(t)) !== null) {
        if (m[1] !== out.kpp && !candidates.includes(m[1])) candidates.push(m[1]);
      }
      bik = candidates.find(c => c.startsWith('04')) || candidates[0] || null;
    }
    if (bik) out.bank_bik = cleanDigits(bik);

    // Название банка. По убыванию приоритета:
    //   1) явная метка «Банк:» / «Наименование банка:».
    //   2) строка с организационно-правовой формой и словом «банк»:
    //      «АО "АЛЬФА-БАНК" г. Москва», «ПАО Сбербанк», «АО Тинькофф Банк».
    //      Требуем «банк» в строке, чтобы не ловить юр. название самого ТСП
    //      (например, «ООО «А Софт»»).
    const bankM = t.match(/(?:^|\n)\s*(?:Банк|Наименование\s+банка)\s*[:\-—]\s*([^\n]+)/i);
    if (bankM) out.bank_name = bankM[1].trim().replace(/[;,]\s*$/, '');
    if (!out.bank_name) {
      const re = /(?:^|\n)\s*((?:ПАО|АО|ООО|ОАО)\s+[^\n]*?)(?=\n|$)/g;
      let m;
      while ((m = re.exec(t)) !== null) {
        if (/банк/i.test(m[1])) { out.bank_name = m[1].trim().replace(/[;,]\s*$/, ''); break; }
      }
    }

    // Полное юр. название.
    const nameM = t.match(/(?:Полное\s+наименование|Наименование\s+организации|Юридическое\s+название|Организация)\s*[:\-—]?\s*([^\n]+)/i);
    if (nameM) out.legal_name = nameM[1].trim().replace(/[;,]\s*$/, '');

    return out;
  }


  // Применяем распарсенные поля к state, не затирая то, что уже введено руками.
  function applyParsedToState(parsed, { overwrite = true } = {}) {
    let n = 0;
    for (const [k, v] of Object.entries(parsed)) {
      if (!v) continue;
      if (!overwrite && state.app[k]) continue;
      if (state.app[k] !== v) {
        state.app[k] = v;
        n++;
      }
    }
    return n;
  }

  async function handleCardFile(file) {
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) {
      setCardStatus('Файл больше 10 МБ — слишком большой', 'error');
      return;
    }
    const ext = (file.name.split('.').pop() || '').toLowerCase();
    if (!['docx','pdf','txt'].includes(ext)) {
      setCardStatus('Неподдерживаемый формат. Нужен .docx, .pdf или .txt', 'error');
      return;
    }
    setCardStatus(`<span class="muted">Распознаю «${escapeHtml(file.name)}»…</span>`, 'muted');
    let text = '';
    try {
      text = await extractTextFromFile(file);
    } catch (e) {
      console.error(e);
      setCardStatus('Не удалось прочитать файл: ' + escapeHtml(e.message || String(e)), 'error');
      return;
    }
    if (!text.trim()) {
      setCardStatus(
        ext === 'pdf'
          ? 'PDF без текстового слоя (похоже, скан). Попробуйте Word или вставьте данные вручную.'
          : 'В файле не найден текст. Попробуйте другой формат.',
        'error');
      return;
    }
    const parsed = parseCompanyCard(text);
    const filledFromCard = applyParsedToState(parsed, { overwrite: true });
    bindFieldInputs();
    updateNextEnabled();
    setDirty();

    // Если в карточке нашли ИНН — параллельно дёргаем DaData, чтобы догнать
    // официальное название/ОГРН/юр.адрес. Карточка уже могла их заполнить,
    // но DaData надёжнее в плане формы собственности и адреса.
    let dadataFilled = 0;
    if (parsed.inn) {
      try {
        const r = await fetch('/api/v1/dadata/party?inn=' + encodeURIComponent(parsed.inn));
        if (r.ok) {
          const json = await r.json();
          const sug = (json.suggestions || [])[0];
          if (sug) {
            const d = sug.data || {};
            const fromDD = {
              kpp: d.kpp || null,
              legal_name: sug.value || d.name?.full_with_opf || null,
              ogrn: d.ogrn || null,
              legal_address: d.address?.value || null,
              signer_position: d.management?.post || null,
              signer_name: d.management?.name || null,
            };
            // overwrite=false — не перетираем то, что уже подтянулось из карточки.
            dadataFilled = applyParsedToState(fromDD, { overwrite: false });
            bindFieldInputs();
          }
        }
      } catch (_) { /* не критично */ }
    }

    const total = filledFromCard + dadataFilled;
    if (total === 0) {
      setCardStatus(
        '⚠ Поля распознать не удалось. Проверьте, есть ли в файле ИНН/КПП/р.счёт/БИК и заполните вручную.',
        'error');
    } else {
      const parts = [];
      parts.push(`Заполнено ${total} ${total % 10 === 1 && total !== 11 ? 'поле' : (total % 10 >= 2 && total % 10 <= 4 && (total < 12 || total > 14) ? 'поля' : 'полей')}`);
      if (parsed.inn && dadataFilled > 0) parts.push('+ DaData по ИНН');
      setCardStatus('✓ ' + parts.join(' ') + '. Проверьте значения ниже.', 'ok');
      if (window.audit) window.audit.log({
        action: 'application_card_parsed',
        target_type: 'application',
        target_id: state.app.id,
        metadata: { filename: file.name, fields_from_card: filledFromCard, fields_from_dadata: dadataFilled },
      });
    }
  }

  // ---------- Шаг 2: DaData по ИНН ----------

  async function fillFromDaData() {
    const inn = ($('#wiz-inn').value || '').replace(/\D/g, '');
    const status = $('#wiz-inn-status');
    if (!isInnValid(inn)) {
      status.textContent = 'ИНН должен содержать 10 или 12 цифр';
      status.className = 'dadata-status error';
      return;
    }
    status.textContent = 'Запрос…';
    status.className = 'dadata-status muted';

    try {
      const r = await fetch('/api/v1/dadata/party?inn=' + encodeURIComponent(inn));
      if (!r.ok) {
        const d = await r.json().catch(() => ({}));
        status.textContent = d.error === 'dadata_not_configured'
          ? 'DaData не настроена в Worker (нужен секрет DADATA_TOKEN)'
          : 'Не удалось получить данные';
        status.className = 'dadata-status error';
        return;
      }
      const json = await r.json();
      const sug = (json.suggestions || [])[0];
      if (!sug) {
        status.textContent = 'Компания с таким ИНН не найдена';
        status.className = 'dadata-status error';
        return;
      }
      const d = sug.data || {};
      state.app.inn = d.inn || inn;
      state.app.kpp = d.kpp || '';
      state.app.legal_name = sug.value || d.name?.full_with_opf || '';
      state.app.ogrn = d.ogrn || '';
      state.app.legal_address = d.address?.value || '';
      const m = d.management || {};
      state.app.signer_name = m.name || (d.fio ? `${d.fio.surname||''} ${d.fio.name||''} ${d.fio.patronymic||''}`.trim() : '');
      state.app.signer_position = m.post || '';
      // Банк не приходит из party — оставляем пользователю.
      bindFieldInputs();
      status.textContent = '✓ Заполнено по DaData';
      status.className = 'dadata-status ok';
      setDirty();
    } catch (e) {
      console.error(e);
      status.textContent = 'Сетевая ошибка';
      status.className = 'dadata-status error';
    }
  }

  // ---------- Шаг 2: DaData по БИК ----------

  async function fillBankFromBik() {
    const bik = ($('#wiz-bik').value || '').replace(/\D/g, '');
    const status = $('#wiz-bik-status');
    if (bik.length !== 9) {
      status.textContent = 'БИК должен содержать 9 цифр';
      status.className = 'dadata-status error';
      return;
    }
    status.textContent = 'Запрос…';
    status.className = 'dadata-status muted';

    try {
      const r = await fetch('/api/v1/dadata/bank?bik=' + encodeURIComponent(bik));
      if (!r.ok) {
        const d = await r.json().catch(() => ({}));
        status.textContent = d.error === 'dadata_not_configured'
          ? 'DaData не настроена в Worker (нужен секрет DADATA_TOKEN)'
          : 'Не удалось получить данные';
        status.className = 'dadata-status error';
        return;
      }
      const json = await r.json();
      const sug = (json.suggestions || [])[0];
      if (!sug) {
        status.textContent = 'Банк с таким БИК не найден';
        status.className = 'dadata-status error';
        return;
      }
      const d = sug.data || {};
      state.app.bank_bik = d.bic || bik;
      // sug.value — короткое название («АО "АЛЬФА-БАНК"»). Если есть город —
      // добавляем «, г. Москва», как принято в карточках.
      const city = d.address?.data?.city_with_type || d.address?.data?.settlement_with_type || '';
      state.app.bank_name = city
        ? `${sug.value || d.name?.payment || ''}${city ? ', ' + city : ''}`
        : (sug.value || d.name?.payment || d.name?.short || '');
      state.app.bank_corr = d.correspondent_account || '';
      bindFieldInputs();
      status.textContent = '✓ Заполнено по DaData';
      status.className = 'dadata-status ok';
      setDirty();
    } catch (e) {
      console.error(e);
      status.textContent = 'Сетевая ошибка';
      status.className = 'dadata-status error';
    }
  }

  // ---------- Шаг 2: интеграция ----------

  function renderIntegration() {
    const root = document.getElementById('wiz-integ-required');
    if (!root) return;
    if (!state.app.integration) state.app.integration = { required: null, presets: {}, custom: [], when: null };
    const ig = state.app.integration;

    // Required radio
    root.querySelectorAll('input[name="integ-required"]').forEach(inp => {
      inp.checked = inp.value === ig.required;
    });
    document.getElementById('wiz-integ-details').hidden = ig.required !== 'yes';

    // When radio
    document.querySelectorAll('input[name="integ-when"]').forEach(inp => {
      inp.checked = inp.value === ig.when;
    });

    // Presets list (чекбокс + поле версии)
    const presetsRoot = document.getElementById('wiz-integ-presets');
    if (presetsRoot) {
      presetsRoot.innerHTML = INTEG_PRESETS.map(name => {
        const checked = Object.prototype.hasOwnProperty.call(ig.presets || {}, name);
        const version = (ig.presets && ig.presets[name]) || '';
        const safeId = 'wiz-integ-preset-' + btoa(unescape(encodeURIComponent(name))).replace(/=/g,'');
        return `
          <div class="integ-preset-row${checked ? ' is-on' : ''}">
            <label class="integ-preset-toggle">
              <input type="checkbox" id="${safeId}" data-preset="${escapeHtml(name)}" ${checked ? 'checked' : ''}>
              <span>${escapeHtml(name)}</span>
            </label>
            <input type="text" class="integ-preset-version" data-preset-ver="${escapeHtml(name)}"
                   placeholder="Укажите версию ${escapeHtml(name)}" value="${escapeHtml(version)}" ${checked ? '' : 'disabled'}>
          </div>`;
      }).join('');
    }

    // Custom systems list
    const customRoot = document.getElementById('wiz-integ-custom-list');
    if (customRoot) {
      const list = ig.custom || [];
      if (list.length === 0) {
        customRoot.innerHTML = '<div class="muted" style="font-size:13px;">Нет своих систем — нажмите «+ Добавить свою систему» ниже.</div>';
      } else {
        customRoot.innerHTML = list.map((s, i) => `
          <div class="integ-custom-row">
            <input type="text" class="integ-custom-name" data-custom-i="${i}" placeholder="Название системы" value="${escapeHtml(s.name || '')}">
            <input type="text" class="integ-custom-ver"  data-custom-i="${i}" placeholder="Версия" value="${escapeHtml(s.version || '')}">
            <button type="button" class="btn sm danger integ-custom-del" data-custom-i="${i}">🗑</button>
          </div>`).join('');
      }
    }

    bindIntegrationHandlers();
  }

  // Привязка обработчиков шага «Интеграция». Безопасно вызывать
  // несколько раз — внутри используется делегирование через _bound флаги.
  function bindIntegrationHandlers() {
    const required = document.getElementById('wiz-integ-required');
    if (required && !required._bound) {
      required._bound = true;
      required.addEventListener('change', (e) => {
        if (e.target?.name !== 'integ-required') return;
        if (!state.app.integration) state.app.integration = {};
        state.app.integration.required = e.target.value;
        renderIntegration();
        setDirty();
      });
    }

    const when = document.getElementById('wiz-integ-when');
    if (when && !when._bound) {
      when._bound = true;
      when.addEventListener('change', (e) => {
        if (e.target?.name !== 'integ-when') return;
        state.app.integration.when = e.target.value;
        setDirty();
      });
    }

    const presetsRoot = document.getElementById('wiz-integ-presets');
    if (presetsRoot && !presetsRoot._bound) {
      presetsRoot._bound = true;
      // Чекбоксы
      presetsRoot.addEventListener('change', (e) => {
        const name = e.target.dataset.preset;
        if (!name) return;
        const ig = state.app.integration;
        if (e.target.checked) ig.presets[name] = ig.presets[name] || '';
        else delete ig.presets[name];
        renderIntegration();
        setDirty();
      });
      // Версии
      presetsRoot.addEventListener('input', (e) => {
        const name = e.target.dataset.presetVer;
        if (!name) return;
        state.app.integration.presets[name] = e.target.value;
        setDirty();
      });
    }

    const customRoot = document.getElementById('wiz-integ-custom-list');
    if (customRoot && !customRoot._bound) {
      customRoot._bound = true;
      customRoot.addEventListener('input', (e) => {
        const i = Number(e.target.dataset.customI);
        if (Number.isNaN(i)) return;
        const row = state.app.integration.custom[i];
        if (!row) return;
        if (e.target.classList.contains('integ-custom-name')) row.name = e.target.value;
        if (e.target.classList.contains('integ-custom-ver')) row.version = e.target.value;
        setDirty();
      });
      customRoot.addEventListener('click', (e) => {
        if (!e.target.classList.contains('integ-custom-del')) return;
        const i = Number(e.target.dataset.customI);
        state.app.integration.custom.splice(i, 1);
        renderIntegration();
        setDirty();
      });
    }

    const addBtn = document.getElementById('wiz-integ-custom-add');
    if (addBtn && !addBtn._bound) {
      addBtn._bound = true;
      addBtn.addEventListener('click', () => {
        if (!state.app.integration.custom) state.app.integration.custom = [];
        state.app.integration.custom.push({ name: '', version: '' });
        renderIntegration();
        setDirty();
      });
    }
  }

  // ---------- Шаг 5: филиалы ----------

  function renderBranches() {
    const list = $('#wiz-branches');
    if (!list) return;
    if (!state.app.branches || state.app.branches.length === 0) {
      // Хотя бы один пустой по умолчанию.
      state.app.branches = [{ address: '' }];
    }
    list.innerHTML = state.app.branches.map((b, i) => `
      <div class="branch-card" data-idx="${i}">
        <div class="branch-row">
          <label class="branch-input">
            <div class="lbl">Адрес *</div>
            <div class="dadata-wrap">
              <input type="text" class="branch-address" data-idx="${i}"
                     value="${escapeHtml(b.address || '')}"
                     placeholder="Например: Москва, Тверская…" autocomplete="off">
              <div class="dadata-suggest" data-idx="${i}" hidden></div>
            </div>
          </label>
          <button type="button" class="btn danger sm branch-del" data-idx="${i}">Удалить</button>
        </div>
      </div>`).join('');

    list.querySelectorAll('.branch-address').forEach(inp => {
      inp.addEventListener('input', onBranchInput);
      inp.addEventListener('blur', () => {
        // Закрываем выпадашку с задержкой, чтобы успел отработать click.
        setTimeout(() => closeSuggest(inp.dataset.idx), 200);
      });
    });
    list.querySelectorAll('.branch-del').forEach(btn => {
      btn.addEventListener('click', () => {
        const i = Number(btn.dataset.idx);
        state.app.branches.splice(i, 1);
        setDirty();
        renderBranches();
        updateNextEnabled();
      });
    });
  }

  let suggestTimer = null;
  function onBranchInput(e) {
    const inp = e.target;
    const idx = Number(inp.dataset.idx);
    state.app.branches[idx] = { ...(state.app.branches[idx] || {}), address: inp.value };
    setDirty();
    updateNextEnabled();
    clearTimeout(suggestTimer);
    suggestTimer = setTimeout(() => fetchAddressSuggest(idx, inp.value), 300);
  }

  async function fetchAddressSuggest(idx, q) {
    const wrap = document.querySelector(`.dadata-suggest[data-idx="${idx}"]`);
    if (!wrap) return;
    if (!q || q.length < 3) { wrap.hidden = true; return; }
    try {
      const r = await fetch('/api/v1/dadata/address?q=' + encodeURIComponent(q));
      if (!r.ok) { wrap.hidden = true; return; }
      const json = await r.json();
      const items = (json.suggestions || []).slice(0, 7);
      if (!items.length) { wrap.hidden = true; return; }
      wrap.innerHTML = items.map((s, i) =>
        `<div class="dadata-item" data-i="${i}">${escapeHtml(s.value)}</div>`).join('');
      wrap.hidden = false;
      wrap.querySelectorAll('.dadata-item').forEach(it => {
        it.addEventListener('mousedown', (e) => e.preventDefault()); // не терять фокус
        it.addEventListener('click', () => {
          const sug = items[Number(it.dataset.i)];
          const data = sug.data || {};
          state.app.branches[idx] = {
            address: sug.value,
            city: data.city_with_type || data.settlement_with_type || data.region_with_type || '',
            lat: data.geo_lat ? Number(data.geo_lat) : null,
            lon: data.geo_lon ? Number(data.geo_lon) : null,
            fias_id: data.fias_id || null,
          };
          setDirty();
          renderBranches();
          updateNextEnabled();
        });
      });
    } catch (e) {
      console.warn('dadata address:', e);
      wrap.hidden = true;
    }
  }
  function closeSuggest(idx) {
    const wrap = document.querySelector(`.dadata-suggest[data-idx="${idx}"]`);
    if (wrap) wrap.hidden = true;
  }

  // ---------- Шаг 5: программа лояльности ----------

  function renderLoyalty() {
    const l = state.app.loyalty || {};
    // Тип программы
    $$('input[name="loyalty_type"]').forEach(r => {
      r.checked = r.value === l.type;
    });

    const subWrap = $('#wiz-subtypes');
    const banner = $('#wiz-external-banner');
    const monthly = $('#wiz-monthly-banner');
    const fields = $('#wiz-loyalty-fields');

    if (!l.type) {
      subWrap.hidden = true;
      banner.hidden = true;
      monthly.hidden = true;
      fields.innerHTML = '';
      return;
    }
    if (l.type === 'external') {
      subWrap.hidden = true;
      banner.hidden = false;
      monthly.hidden = true;
      fields.innerHTML = '';
      return;
    }
    // bonus / discount
    banner.hidden = true;
    subWrap.hidden = false;
    const sub = l.subtype || 'basic';
    $$('#wiz-subtype-tabs .subtype-tab').forEach(t => {
      t.classList.toggle('active', t.dataset.sub === sub);
    });
    monthly.hidden = sub !== 'cumulative_plus';
    fields.innerHTML = renderLoyaltyFieldsHtml(l.type, sub, l);
    bindLoyaltyFieldHandlers();
  }

  function renderLoyaltyFieldsHtml(type, sub, l) {
    if (type === 'bonus') {
      if (sub === 'basic') {
        return `
          ${rowSegmented('Время действия бонусов', 'validity', l.validity || 'year', [['year','Год'],['unlimited','Неограниченно']])}
          ${rowSegmented('Тип сгорания бонусов', 'burn_type', l.burn_type || 'by_purchase_date', [['by_purchase_date','По очередности от даты покупки'],['by_last_purchase','От последней покупки']])}
          ${rowPercent('Процент начисления бонусов', 'accrual_percent', l.accrual_percent ?? 0)}
          ${rowPercent('Процент оплаты бонусами', 'payment_percent', l.payment_percent ?? 0)}
          ${rowNumber('Уведомить о сгорании за (дней)', 'burn_notify_days', l.burn_notify_days ?? 7)}
        `;
      }
      if (sub === 'cumulative') {
        return `
          ${rowSegmented('Время действия порогов', 'tier_validity', l.tier_validity || 'year', [['year','Год'],['unlimited','Неограниченно']])}
          ${rowSegmented('Время действия бонусов', 'validity', l.validity || 'year', [['year','Год'],['unlimited','Неограниченно']])}
          ${rowSegmented('Тип сгорания бонусов', 'burn_type', l.burn_type || 'by_purchase_date', [['by_purchase_date','От даты покупки'],['by_last_purchase','От последней покупки']])}
          ${rowPercent('Процент оплаты бонусами', 'payment_percent', l.payment_percent ?? 0)}
          ${rowNumber('Уведомить о сгорании за (дней)', 'burn_notify_days', l.burn_notify_days ?? 7)}
          ${rowStartPercent(l, 'bonus')}
          ${tiersBlock('Пороги получения бонусов', 'tiers', l.tiers || [], true)}
        `;
      }
      // cumulative_plus
      return `
        ${rowSegmented('Время действия бонусов', 'validity', l.validity || 'year', [['year','Год'],['unlimited','Неограниченно']])}
        ${rowSegmented('Тип сгорания бонусов', 'burn_type', l.burn_type || 'by_purchase_date', [['by_purchase_date','От даты покупки'],['by_last_purchase','От последней покупки']])}
        ${rowPercent('Процент оплаты бонусами', 'payment_percent', l.payment_percent ?? 0)}
        ${rowNumber('Уведомить о сгорании за (дней)', 'burn_notify_days', l.burn_notify_days ?? 7)}
        ${rowStartPercent(l, 'bonus')}
        ${tiersBlock('Пороги получения бонусов в месяц', 'monthly_tiers', l.monthly_tiers || [], true)}
      `;
    }
    // type === 'discount'
    if (sub === 'basic') {
      return `
        ${rowSegmented('Время действия скидки', 'validity', l.validity || 'year', [['year','Год'],['unlimited','Неограниченно']])}
        ${rowPercent('Процент скидки на чек', 'discount_percent', l.discount_percent ?? 0)}
      `;
    }
    if (sub === 'cumulative') {
      return `
        ${rowSegmented('Время действия порогов', 'tier_validity', l.tier_validity || 'year', [['year','Год'],['unlimited','Неограниченно']])}
        ${rowStartPercent(l, 'discount')}
        ${tiersBlock('Пороги получения скидки', 'tiers', l.tiers || [], false)}
      `;
    }
    // discount cumulative_plus
    return `
      ${rowStartPercent(l, 'discount')}
      ${tiersBlock('Пороги получения скидки в месяц', 'monthly_tiers', l.monthly_tiers || [], false)}
    `;
  }

  function rowSegmented(label, key, value, opts) {
    return `
      <div class="loy-row">
        <div class="lbl">${escapeHtml(label)}</div>
        <div class="seg-group" data-key="${key}">
          ${opts.map(([v, n]) => `
            <button type="button" class="seg-btn ${v===value?'active':''}" data-v="${v}">${escapeHtml(n)}</button>
          `).join('')}
        </div>
      </div>`;
  }

  function rowPercent(label, key, value) {
    return `
      <div class="loy-row">
        <div class="lbl">${escapeHtml(label)}</div>
        <div class="pct-row">
          <input type="number" min="0" max="100" step="1" class="pct-input" data-key="${key}" value="${value}">
          <span class="pct-suffix">%</span>
          <input type="range" min="0" max="100" step="1" class="pct-range" data-key="${key}" value="${value}">
        </div>
      </div>`;
  }

  function rowNumber(label, key, value) {
    return `
      <div class="loy-row">
        <div class="lbl">${escapeHtml(label)}</div>
        <input type="number" min="0" max="365" step="1" class="num-input" data-key="${key}" value="${value}">
      </div>`;
  }

  function rowToggle(label, key, value, hint) {
    return `
      <div class="loy-row">
        <label class="toggle">
          <input type="checkbox" class="tgl-input" data-key="${key}" ${value?'checked':''}>
          <span class="tgl-track"><span class="tgl-thumb"></span></span>
          <span class="tgl-label">${escapeHtml(label)}</span>
        </label>
        ${hint ? `<div class="loy-hint">${escapeHtml(hint)}</div>` : ''}
      </div>`;
  }

  // Стартовый процент: тоггл с двумя состояниями.
  //  Выключен → показываем пояснение «Стартовый процент отключён…».
  //  Включён  → появляется поле «Процент начисления …» (0–100%).
  // Семантика данных оставлена как раньше: l.no_start_percent (true=отключён),
  // плюс новое поле l.start_percent (0–100). Так старые черновики без
  // start_percent просто получат значение по умолчанию.
  function rowStartPercent(l, kind) {
    const enabled = !l.no_start_percent;
    const value = (l.start_percent ?? 0);
    const offHint = kind === 'bonus'
      ? 'Стартовый процент отключён (Клиенту не будут начисляться бонусы, пока он не достигнет 1-го порога).'
      : 'Стартовый процент отключён (Клиент не получает скидку, пока он не достигнет 1-го порога).';
    const inputLabel = kind === 'bonus' ? 'Процент начисления бонусов' : 'Процент начисления скидки';
    return `
      <div class="loy-row start-percent-row">
        <label class="toggle">
          <input type="checkbox" class="tgl-input" data-key="start_percent_enabled" ${enabled?'checked':''}>
          <span class="tgl-track"><span class="tgl-thumb"></span></span>
          <span class="tgl-label">Стартовый процент</span>
        </label>
        <div class="start-percent-on" ${enabled?'':'hidden'}>
          <div class="lbl" style="margin-top:10px;">${escapeHtml(inputLabel)}</div>
          <div class="pct-row">
            <input type="number" min="0" max="100" step="1" class="pct-input" data-key="start_percent" value="${value}">
            <span class="pct-suffix">%</span>
            <input type="range" min="0" max="100" step="1" class="pct-range" data-key="start_percent" value="${value}">
          </div>
        </div>
        <div class="loy-hint start-percent-off" ${enabled?'hidden':''}>${escapeHtml(offHint)}</div>
      </div>`;
  }

  function tiersBlock(title, key, tiers, isBonus) {
    const colName = isBonus ? '% начисления' : '% скидки';
    const rows = tiers.map((t, i) => `
      <div class="tier-row" data-i="${i}">
        <input type="text" class="tier-name" data-i="${i}" placeholder="Название (например, «Бронза»)" value="${escapeHtml(t.name||'')}">
        <input type="number" min="0" class="tier-amount" data-i="${i}" placeholder="Потраченная сумма, ₽" value="${t.amount||''}">
        <input type="number" min="0" max="100" class="tier-percent" data-i="${i}" placeholder="${colName}" value="${t.percent||''}">
        <button type="button" class="btn danger sm tier-del" data-i="${i}">×</button>
      </div>`).join('');
    return `
      <div class="loy-row tiers" data-tier-key="${key}">
        <div class="tiers-head">
          <div class="lbl">${escapeHtml(title)}</div>
          <button type="button" class="btn sm tier-add">+ Добавить ещё</button>
        </div>
        <div class="tiers-list">
          ${rows || '<div class="muted" style="font-size:13px;">Нет порогов. Нажмите «Добавить ещё».</div>'}
        </div>
      </div>`;
  }

  // Webkit (Chrome/Safari) сам не умеет заливать прогресс на range —
  // рисуем градиентом, который обновляется при каждом изменении значения.
  // Firefox использует ::-moz-range-progress (см. styles.css), там это
  // не нужно, но и градиент не мешает.
  function paintRangeFill(range) {
    const min = Number(range.min) || 0;
    const max = Number(range.max) || 100;
    const v = Math.max(min, Math.min(max, Number(range.value) || 0));
    const pct = max === min ? 0 : ((v - min) / (max - min)) * 100;
    range.style.background =
      `linear-gradient(to right, var(--accent) 0%, var(--accent) ${pct}%, var(--border) ${pct}%, var(--border) 100%)`;
  }

  function bindLoyaltyFieldHandlers() {
    const fields = $('#wiz-loyalty-fields');
    if (!fields) return;
    // Сразу красим все слайдеры в текущем рендере.
    fields.querySelectorAll('.pct-range').forEach(paintRangeFill);

    // Если бонусы действуют «Неограниченно» — они никогда не сгорают,
    // поэтому строки «Тип сгорания» и «Уведомить о сгорании за» не имеют
    // смысла. Прячем их, чтобы не путать пользователя.
    function updateBurnVisibility() {
      const l = state.app.loyalty || {};
      const unlimited = (l.validity || 'year') === 'unlimited';
      const burnRow = fields.querySelector('[data-key="burn_type"]')?.closest('.loy-row');
      const notifyRow = fields.querySelector('[data-key="burn_notify_days"]')?.closest('.loy-row');
      if (burnRow) burnRow.hidden = unlimited;
      if (notifyRow) notifyRow.hidden = unlimited;
    }
    updateBurnVisibility();

    fields.querySelectorAll('.seg-group').forEach(g => {
      const key = g.dataset.key;
      g.querySelectorAll('.seg-btn').forEach(b => {
        b.addEventListener('click', () => {
          state.app.loyalty = { ...(state.app.loyalty || {}), [key]: b.dataset.v };
          setDirty();
          g.querySelectorAll('.seg-btn').forEach(x => x.classList.remove('active'));
          b.classList.add('active');
          if (key === 'validity') updateBurnVisibility();
        });
      });
    });

    fields.querySelectorAll('.pct-input, .pct-range, .num-input').forEach(inp => {
      const key = inp.dataset.key;
      inp.addEventListener('input', () => {
        const v = Math.max(0, Math.min(inp.classList.contains('num-input') ? 365 : 100, Number(inp.value) || 0));
        state.app.loyalty = { ...(state.app.loyalty || {}), [key]: v };
        setDirty();
        // Синхронизируем парный input/range и перекрашиваем заливку.
        fields.querySelectorAll(`[data-key="${key}"]`).forEach(other => {
          if (other !== inp) other.value = v;
          if (other.classList.contains('pct-range')) paintRangeFill(other);
        });
        if (inp.classList.contains('pct-range')) paintRangeFill(inp);
      });
    });

    fields.querySelectorAll('.tgl-input').forEach(inp => {
      const key = inp.dataset.key;
      inp.addEventListener('change', () => {
        if (key === 'start_percent_enabled') {
          // Семантика обратная: тоггл «включён» = стартовый процент работает,
          // в данных храним no_start_percent = !checked для совместимости
          // со старыми черновиками.
          state.app.loyalty = { ...(state.app.loyalty || {}), no_start_percent: !inp.checked };
          // Показываем/прячем зависимые блоки прямо в этой же строке.
          const row = inp.closest('.start-percent-row');
          const onBlock = row?.querySelector('.start-percent-on');
          const offBlock = row?.querySelector('.start-percent-off');
          if (onBlock) onBlock.hidden = !inp.checked;
          if (offBlock) offBlock.hidden = inp.checked;
        } else {
          state.app.loyalty = { ...(state.app.loyalty || {}), [key]: inp.checked };
        }
        setDirty();
      });
    });

    fields.querySelectorAll('.tier-add').forEach(btn => {
      btn.addEventListener('click', () => {
        const block = btn.closest('[data-tier-key]');
        const key = block.dataset.tierKey;
        const cur = state.app.loyalty?.[key] || [];
        state.app.loyalty = { ...(state.app.loyalty || {}), [key]: [...cur, { name:'', amount:0, percent:0 }] };
        setDirty();
        renderLoyalty();
      });
    });

    fields.querySelectorAll('.tier-del').forEach(btn => {
      btn.addEventListener('click', () => {
        const block = btn.closest('[data-tier-key]');
        const key = block.dataset.tierKey;
        const i = Number(btn.dataset.i);
        const arr = [...(state.app.loyalty?.[key] || [])];
        arr.splice(i, 1);
        state.app.loyalty = { ...(state.app.loyalty || {}), [key]: arr };
        setDirty();
        renderLoyalty();
      });
    });

    fields.querySelectorAll('.tier-name, .tier-amount, .tier-percent').forEach(inp => {
      inp.addEventListener('input', () => {
        const block = inp.closest('[data-tier-key]');
        const key = block.dataset.tierKey;
        const i = Number(inp.dataset.i);
        const arr = [...(state.app.loyalty?.[key] || [])];
        const t = { ...(arr[i] || {}) };
        if (inp.classList.contains('tier-name')) t.name = inp.value;
        if (inp.classList.contains('tier-amount')) t.amount = Number(inp.value) || 0;
        if (inp.classList.contains('tier-percent')) t.percent = Number(inp.value) || 0;
        arr[i] = t;
        state.app.loyalty = { ...(state.app.loyalty || {}), [key]: arr };
        setDirty();
      });
    });
  }

  // ---------- Навигация ----------

  function goStep(n) {
    if (n < 1 || n > TOTAL_STEPS) return;
    // Свободная навигация: пользователь может прыгать по любым шагам
    // в любой последовательности. Валидация выполняется только при
    // нажатии «Передать Гари» (см. submitToGary).
    state.currentStep = n;
    state.visitedSteps.add(n);
    renderAll();
    bindFileInputs();
    if (n === 2) renderIntegration();
    if (n === 5) renderBranches();
    if (n === 6) renderLoyalty();
    // Намеренно НЕ скроллим страницу при переключении шагов — пользователь
    // остаётся ровно там, где кликнул по индикатору.
  }

  // ---------- Передать Гари ----------

  async function submitToGary() {
    const errors = validateStep(TOTAL_STEPS);
    if (errors.length) { toast(errors[0], 'error'); return; }
    // Сначала сохраняем как черновик, чтобы данные были в БД.
    const saved = await saveDraft({ silent: true });
    if (!saved) return;
    const btn = $('#wiz-next');
    if (btn) { btn.disabled = true; btn.textContent = 'Отправляем…'; }
    try {
      const { data: { session } } = await sb.auth.getSession();
      const token = session?.access_token;
      const r = await fetch(`/api/v1/applications/${state.app.id}/submit`, {
        method: 'POST',
        headers: token ? { authorization: 'Bearer ' + token } : {},
      });
      const json = await r.json().catch(() => ({}));
      if (!r.ok) {
        toast('Не удалось отправить: ' + (json.error || r.status), 'error');
        if (btn) { btn.disabled = false; btn.textContent = 'Передать Гари'; }
        return;
      }
      toast('Заявка принята в работу');
      state.app.status = 'new';
      state.dirty = false;
      if (window.audit) window.audit.log({
        action: 'application_submit',
        target_type: 'application',
        target_id: state.app.id,
        metadata: { webhook_status: json.webhook_status },
      });
      // Создаём уведомление менеджеру.
      try {
        await sb.from('notifications').insert({
          user_id: state.sellerId,
          title: 'Заявка принята в работу',
          body: `Заявка «${state.app.company_name || '—'}» отправлена Гари.`,
          link: 'seller.html#deals',
        });
      } catch (_) {}
      // После отправки — на список сделок.
      setTimeout(() => switchToDeals(), 800);
    } catch (e) {
      toast('Сетевая ошибка', 'error');
      console.error(e);
      if (btn) { btn.disabled = false; btn.textContent = 'Передать Гари'; }
    }
  }

  // ---------- «Мои сделки» ----------

  async function loadDeals() {
    const list = $('#deals-list');
    if (!list) return;
    list.innerHTML = '<div class="empty plain">Загрузка…</div>';
    const { data, error } = await sb.from('applications')
      .select('id, status, company_name, category_id, short_desc, branches, created_at, updated_at, submitted_at')
      .eq('seller_id', state.sellerId)
      .order('updated_at', { ascending: false });
    if (error) {
      list.innerHTML = `<div class="empty">Ошибка: ${escapeHtml(error.message)}</div>`;
      return;
    }
    state.deals = data || [];
    renderDeals();
  }

  function renderDeals() {
    const list = $('#deals-list');
    if (!list) return;
    if (!state.deals.length) {
      list.innerHTML = `
        <div class="empty plain" style="text-align:center;padding:40px 20px;">
          <div style="font-size:32px;margin-bottom:8px;">📋</div>
          У вас пока нет заявок.<br>
          Перейдите на вкладку «Подключение компании», чтобы создать первую.
        </div>`;
      return;
    }
    const cats = Object.fromEntries(state.categories.map(c => [c.id, c]));
    list.innerHTML = state.deals.map(d => {
      const st = STATUS_LABELS[d.status] || { label: d.status, cls: 'muted', badge: '' };
      const cat = cats[d.category_id];
      const date = d.submitted_at || d.updated_at || d.created_at;
      const dt = date ? new Date(date).toLocaleString('ru-RU', { day:'2-digit', month:'short', hour:'2-digit', minute:'2-digit' }) : '';
      const canDelete = d.status === 'draft';
      const isGary = st.badge === 'badge-working';
      const chipText = isGary ? garyChipForDeal(d) : '';
      const badgeHtml = st.badge
        ? `<span class="deal-badge ${st.badge}">${escapeHtml(st.label)}</span>${chipText ? ` <span class="gary-step-chip">${escapeHtml(chipText)}</span>` : ''}`
        : `<span class="badge ${st.cls}">${escapeHtml(st.label)}</span>`;
      const city = dealCity(d);
      const shortDesc = (d.short_desc || '').trim();
      const descShort = shortDesc.length > 120 ? shortDesc.slice(0, 117) + '…' : shortDesc;
      return `
        <div class="deal-card" data-id="${d.id}">
          <div class="deal-main">
            <div class="deal-name">${escapeHtml(d.company_name || '— без названия —')}</div>
            <div class="deal-meta">
              ${cat ? `<span>${cat.icon || ''} ${escapeHtml(cat.name)}</span>` : ''}
              ${city ? `<span>· 📍 ${escapeHtml(city)}</span>` : ''}
              <span>· ${escapeHtml(dt)}</span>
            </div>
            ${descShort ? `<div class="deal-desc">${escapeHtml(descShort)}</div>` : ''}
          </div>
          ${badgeHtml}
          <button class="btn sm deal-open" data-id="${d.id}">${d.status === 'draft' ? 'Продолжить' : 'Открыть'}</button>
          ${canDelete ? `<button class="btn sm danger deal-delete" data-id="${d.id}" title="Удалить черновик">🗑 Удалить</button>` : ''}
        </div>`;
    }).join('');
    list.querySelectorAll('.deal-open').forEach(btn => {
      btn.addEventListener('click', async () => {
        await loadApplication(btn.dataset.id);
        switchToConnect();
      });
    });
    list.querySelectorAll('.deal-delete').forEach(btn => {
      btn.addEventListener('click', async () => {
        const id = btn.dataset.id;
        const deal = state.deals.find(x => x.id === id);
        const name = deal?.company_name || '— без названия —';
        const ok = await confirmDialog({
          title: `Удалить черновик «${name}»?`,
          message: 'Действие нельзя отменить — данные пропадут безвозвратно.',
          okText: 'Удалить',
          cancelText: 'Отмена',
          danger: true,
        });
        if (!ok) return;
        btn.disabled = true; btn.textContent = 'Удаляем…';
        const { error } = await sb.from('applications').delete().eq('id', id);
        if (error) {
          toast('Не удалось удалить: ' + error.message, 'error');
          btn.disabled = false; btn.textContent = '🗑 Удалить';
          console.error(error);
          return;
        }
        // Чистим локальное зеркало (если вдруг было) и перезагружаем список.
        clearLocalMirror(id);
        if (window.audit) window.audit.log({
          action: 'application_delete_draft',
          target_type: 'application',
          target_id: id,
        });
        toast('Черновик удалён');
        await loadDeals();
      });
    });
  }

  function switchToConnect() {
    document.querySelector('#seller-nav .seller-tab[data-section="connect"]')?.click();
  }
  function switchToDeals() {
    document.querySelector('#seller-nav .seller-tab[data-section="deals"]')?.click();
    loadDeals();
  }

  function showWizard() {
    // Кнопка «← К списку» теперь всегда видима в шапке мастера —
    // и для новой заявки (вернуться без сохранения), и для существующей.
    renderGaryBlock();
  }

  function renderGaryBlock() {
    const container = $('#gary-block-container');
    if (!container) return;
    const status = state.app.status;
    const isGaryActive = status && status !== 'draft' && status !== 'ready' && status !== 'launched';
    const isDone = status === 'ready' || status === 'launched';

    if (!status || status === 'draft') {
      container.hidden = true;
      container.innerHTML = '';
      return;
    }

    // Найти текущий шаг по статусу
    let currentIdx = -1;
    GARY_STEPS.forEach((step, i) => {
      if (step.statuses.includes(status)) currentIdx = i;
    });
    // Если статус не найден явно — берём первый шаг (передана Гари)
    if (currentIdx === -1 && isGaryActive) currentIdx = 1;
    if (isDone) currentIdx = GARY_STEPS.length - 1;

    const chipLabel = isDone
      ? '✓ Завершено'
      : `▶ ${garyChipForDeal(state.app)}`;
    const headChipHtml = `<span class="gary-status-chip">${escapeHtml(chipLabel)}</span>`;

    const stepsHtml = GARY_STEPS.map((step, idx) => {
      let stateClass = 'step-future';
      if (isDone || idx < currentIdx) stateClass = 'step-done';
      else if (idx === currentIdx) stateClass = 'step-current';
      const icon = (isDone || idx < currentIdx) ? '✓' : step.icon;
      const badge = idx === currentIdx && !isDone
        ? `<span class="gary-current-badge">▶ Сейчас</span>` : '';
      return `
        <div class="gary-step ${stateClass}">
          <div class="gary-step-icon">${icon}</div>
          <div class="gary-step-body">
            ${badge}
            <p class="gary-step-title">${escapeHtml(step.label)}</p>
          </div>
        </div>`;
    }).join('');

    container.hidden = false;
    container.innerHTML = `
      <div class="gary-block">
        <div class="gary-block-head">
          <div class="gary-avatar">🤖</div>
          <h2>Режим работы Гари</h2>
          ${headChipHtml}
        </div>
        <div class="gary-steps">${stepsHtml}</div>
      </div>`;
  }

  // ---------- Привязка обработчиков ----------

  function wireActions() {
    const nextBtn = $('#wiz-next');
    nextBtn.addEventListener('click', async () => {
      // В режиме просмотра — простая навигация по шагам.
      if (state.readOnly) {
        if (state.currentStep < TOTAL_STEPS) goStep(state.currentStep + 1);
        return;
      }
      // На промежуточных шагах «Далее» НЕ блокирует — пользователь может
      // заполнять в любой последовательности. Валидация ВСЕХ шагов
      // выполняется только при «Передать Гари» на последнем шаге.
      if (state.currentStep < TOTAL_STEPS) {
        goStep(state.currentStep + 1);
        return;
      }
      const allErrors = [];
      const allFields = [];
      for (let s = 1; s <= TOTAL_STEPS; s++) {
        const issues = getStepIssues(s);
        allErrors.push(...issues.errors);
        if (issues.fields) allFields.push(...issues.fields);
      }
      if (allErrors.length) {
        highlightInvalidFields(allFields);
        await confirmDialog({
          title: 'Заполните, пожалуйста',
          message: allErrors.map(e => '• ' + e).join('\n'),
          okText: 'Понятно',
          cancelText: '',
        });
        return;
      }
      submitToGary();
    });

    // Всплывающая подсказка при наведении на «Далее», если шаг не валиден.
    let nextTip = null;
    nextBtn.addEventListener('mouseenter', () => {
      if (state.readOnly) return;
      const issues = getStepIssues(state.currentStep);
      if (!issues.errors.length) return;
      nextTip = document.createElement('div');
      nextTip.className = 'next-tooltip';
      nextTip.innerHTML = `
        <div class="next-tooltip-title">Заполните, пожалуйста:</div>
        <ul>${issues.errors.map(e => `<li>${escapeHtml(e)}</li>`).join('')}</ul>
      `;
      document.body.appendChild(nextTip);
      const r = nextBtn.getBoundingClientRect();
      nextTip.style.left = (r.left + r.width / 2) + 'px';
      nextTip.style.bottom = (window.innerHeight - r.top + 10) + 'px';
    });
    nextBtn.addEventListener('mouseleave', () => {
      nextTip?.remove();
      nextTip = null;
    });
    $('#wiz-prev').addEventListener('click', () => goStep(state.currentStep - 1));
    $('#wiz-save-draft').addEventListener('click', () => saveDraft({ silent: false }));
    $('#wiz-save-draft-2').addEventListener('click', () => saveDraft({ silent: false }));
    $('#wiz-back-to-list')?.addEventListener('click', () => switchToDeals());

    // Клик по индикатору шагов — свободная навигация по любому шагу.
    $$('#wiz-steps .wiz-step').forEach(li => {
      li.addEventListener('click', () => {
        const n = Number(li.dataset.step);
        if (n) goStep(n);
      });
    });

    // Шаг 2: DaData
    $('#wiz-inn-fetch')?.addEventListener('click', fillFromDaData);
    $('#wiz-bik-fetch')?.addEventListener('click', fillBankFromBik);

    // Шаг 2: загрузка карточки предприятия
    const cardPick = $('#wiz-card-pick');
    const cardInput = $('#wiz-card-input');
    if (cardPick && cardInput) {
      cardPick.addEventListener('click', () => cardInput.click());
      cardInput.addEventListener('change', async (e) => {
        const f = e.target.files?.[0];
        if (f) await handleCardFile(f);
        e.target.value = '';
      });
    }
    // Drag & drop для блока карточки
    const cardBlock = $('#wiz-card-block');
    if (cardBlock) {
      ['dragenter', 'dragover'].forEach(ev => cardBlock.addEventListener(ev, (e) => {
        e.preventDefault(); cardBlock.classList.add('drag-over');
      }));
      ['dragleave', 'drop'].forEach(ev => cardBlock.addEventListener(ev, (e) => {
        e.preventDefault(); cardBlock.classList.remove('drag-over');
      }));
      cardBlock.addEventListener('drop', async (e) => {
        const f = e.dataTransfer?.files?.[0];
        if (f) await handleCardFile(f);
      });
    }

    // Шаг 3: подтверждение e-mail и телефона ЛПР.
    // Реальной отправки кода ещё нет — это заглушка, проверяет только
    // длину (5 цифр). Логика одной кнопки с тремя состояниями:
    //   send     — «Отправить код» (поле кода неактивно).
    //   confirm  — «Подтвердить»   (поле кода активно, код можно вводить).
    //   verified — «✓ Подтверждён» (зелёная, неактивная).
    // Под кнопкой — таймер «Отправить код повторно через X сек».
    // Когда таймер дойдёт до нуля — текст становится кликабельной ссылкой.
    function setupVerify({ stateKey, fieldId, codeInputId, actionBtnId,
                           resendId, resendSeconds, valueLabel, codeChannel,
                           isValueOk }) {
      const inp = $('#' + fieldId);
      const codeInput = $('#' + codeInputId);
      const actionBtn = $('#' + actionBtnId);
      const resend = $('#' + resendId);
      if (!inp || !actionBtn) return;

      let resendTimer = null;
      let resendLeft = 0;

      function setBtnState(st) {
        actionBtn.dataset.st = st;
        actionBtn.classList.remove('primary', 'danger');
        if (st === 'send' || st === 'confirm') actionBtn.classList.add('primary');
        if (st === 'verified') actionBtn.textContent = '✓ Подтверждён';
        else if (st === 'confirm') actionBtn.textContent = 'Подтвердить';
        else actionBtn.textContent = 'Отправить код';
      }

      function stopResendTimer() {
        if (resendTimer) { clearInterval(resendTimer); resendTimer = null; }
      }

      function renderResend() {
        if (resendLeft > 0) {
          resend.classList.remove('ready');
          resend.textContent = `Отправить код повторно через ${resendLeft} сек`;
        } else {
          resend.classList.add('ready');
          resend.textContent = 'Отправить код повторно';
        }
      }

      function startResendTimer() {
        stopResendTimer();
        resendLeft = resendSeconds;
        resend.hidden = false;
        renderResend();
        resendTimer = setInterval(() => {
          resendLeft--;
          if (resendLeft <= 0) { stopResendTimer(); resendLeft = 0; }
          renderResend();
        }, 1000);
      }

      function refreshUi() {
        if (state.app[stateKey]) {
          setBtnState('verified');
          codeInput.disabled = true;
          codeInput.value = '';
          resend.hidden = true;
          stopResendTimer();
        } else if (actionBtn.dataset.st === 'verified') {
          setBtnState('send');
          codeInput.disabled = true;
          codeInput.value = '';
          resend.hidden = true;
          stopResendTimer();
        }
      }

      // Клик по кнопке: ветка по текущему состоянию.
      actionBtn.addEventListener('click', () => {
        const st = actionBtn.dataset.st;
        if (st === 'send') {
          if (!isValueOk()) {
            toast('Сначала заполните «' + valueLabel + '» корректно', 'error');
            return;
          }
          // Здесь когда-нибудь будет реальная отправка по API.
          codeInput.disabled = false;
          codeInput.value = '';
          codeInput.focus();
          setBtnState('confirm');
          startResendTimer();
          toast('Код отправлен (заглушка) — введите любые 5 цифр');
        } else if (st === 'confirm') {
          const code = (codeInput.value || '').replace(/\D/g, '');
          if (code.length !== 5) {
            toast('Введите 5 цифр кода', 'error');
            codeInput.focus();
            return;
          }
          state.app[stateKey] = true;
          setDirty();
          setBtnState('verified');
          codeInput.disabled = true;
          resend.hidden = true;
          stopResendTimer();
          toast('Подтверждено');
        }
        // verified — кнопка некликабельна (pointer-events: none в CSS).
      });

      // Клик по «Отправить код повторно» (когда таймер обнулился).
      resend.addEventListener('click', () => {
        if (!resend.classList.contains('ready')) return;
        if (!isValueOk()) {
          toast('Сначала заполните «' + valueLabel + '» корректно', 'error');
          return;
        }
        codeInput.value = '';
        codeInput.focus();
        startResendTimer();
        toast('Код отправлен повторно (заглушка)');
      });

      // Если меняется само поле e-mail / телефона — сбрасываем подтверждение
      // и возвращаем кнопку к «Отправить код».
      inp.addEventListener('input', () => {
        if (state.app[stateKey]) {
          state.app[stateKey] = false;
          setDirty();
        }
        codeInput.disabled = true;
        codeInput.value = '';
        resend.hidden = true;
        stopResendTimer();
        setBtnState('send');
      });

      refreshUi();
    }

    setupVerify({
      stateKey: 'email_verified',
      fieldId: 'wiz-email',
      codeInputId: 'wiz-email-code',
      actionBtnId: 'wiz-email-action',
      resendId: 'wiz-email-resend',
      resendSeconds: 20,
      valueLabel: 'E-mail',
      codeChannel: 'email',
      isValueOk: () => isEmailValid(state.app.email),
    });
    setupVerify({
      stateKey: 'lpr_phone_verified',
      fieldId: 'wiz-lpr-phone',
      codeInputId: 'wiz-lpr-phone-code',
      actionBtnId: 'wiz-lpr-phone-action',
      resendId: 'wiz-lpr-phone-resend',
      resendSeconds: 30,
      valueLabel: 'Телефон ЛПР',
      codeChannel: 'sms',
      isValueOk: () => isPhoneValid(state.app.lpr_phone),
    });

    // Шаг 4: добавить филиал
    $('#wiz-add-branch')?.addEventListener('click', () => {
      state.app.branches = [...(state.app.branches || []), { address: '' }];
      setDirty();
      renderBranches();
      updateNextEnabled();
    });

    // Шаг 5: тип программы
    $$('input[name="loyalty_type"]').forEach(r => {
      r.addEventListener('change', () => {
        const t = r.value;
        if (t === 'external') {
          state.app.loyalty = { type: 'external' };
        } else {
          state.app.loyalty = { type: t, subtype: 'basic' };
        }
        setDirty();
        renderLoyalty();
        updateNextEnabled();
      });
    });

    // Шаг 5: подтип
    $$('#wiz-subtype-tabs .subtype-tab').forEach(t => {
      t.addEventListener('click', () => {
        if (!state.app.loyalty || !['bonus','discount'].includes(state.app.loyalty.type)) return;
        state.app.loyalty = { ...state.app.loyalty, subtype: t.dataset.sub };
        // Сбрасываем поля, специфичные для другого подтипа, но оставляем общие — пусть пересчитает по умолчанию.
        setDirty();
        renderLoyalty();
        updateNextEnabled();
      });
    });

    // Шаг 5: «Помоги выбрать»
    $('#wiz-loyalty-help')?.addEventListener('click', () => {
      const b = $('#wiz-loyalty-help-banner');
      if (b) b.hidden = !b.hidden;
    });

    // Кнопка из «Мои сделки»
    $('#deals-new')?.addEventListener('click', async () => {
      await startNewApplication();
      switchToConnect();
    });

    // Beforeunload guard
    window.addEventListener('beforeunload', (e) => {
      if (state.dirty) { e.preventDefault(); e.returnValue = ''; }
    });

    // Если переключаются на «Мои сделки» — обновляем список.
    document.querySelectorAll('#seller-nav .seller-tab').forEach(btn => {
      btn.addEventListener('click', () => {
        if (btn.dataset.section === 'deals') loadDeals();
      });
    });
  }

  // ---------- Старт ----------

  async function init() {
    const { data: { user } } = await sb.auth.getUser();
    if (!user) return; // cabinet-shell.js перенаправит на login
    state.sellerId = user.id;
    await loadCategories();
    state.app.seller_id = state.sellerId;
    renderAll();
    bindFileInputs();
    wireActions();

    // Если в hash указан id заявки — открываем её.
    const hash = location.hash.replace(/^#/, '');
    const m = hash.match(/^app:([0-9a-f-]{36})$/);
    if (m) {
      await loadApplication(m[1]);
      switchToConnect();
    }
    // Если активна вкладка deals — подгрузим список.
    if (location.hash === '#deals') loadDeals();
  }

  init();
})();
