// Раздел «Мои лиды» — лиды от операторов холодных звонков, ждут встречи
// с менеджером. Загружаются из public.leads (Supabase) — фильтр по
// manager_id = текущий менеджер. Поля pitch/recommendations/operator_call
// заполняются позже агентом Гари; для свежих лидов от оператора они
// пустые — соответствующие блоки UI не рендерятся.

(function () {
  'use strict';

  let LEADS = [];

  const $ = (sel, el = document) => el.querySelector(sel);

  let activeId = null;
  // 'board' (канбан) | 'detail' (открытая карточка). По умолчанию — board.
  let view = 'board';
  // Активная вкладка в блоке «Звонок оператора»: 'transcript' | 'audio'.
  // Запоминается между переключениями лидов в рамках сессии.
  let activeCallTab = 'transcript';

  // Канбан-колонки. Зеркало operator-leads.STATUS_COLUMNS.
  const STATUS_COLUMNS = [
    { key: 'meeting_scheduled', title: 'Назначенные встречи' },
    { key: 'meeting_confirmed', title: 'Подтверждённая встреча' },
    { key: 'meeting_failed',    title: 'Не состоялась встреча, перезвонить' },
    { key: 'decision_pending',  title: 'Принимает решение' },
    { key: 'callback',          title: 'Интеграция' },
    { key: 'reschedule',        title: 'На тесте' },
  ];

  const WEEKDAYS_SHORT_RU = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'];

  // ---------- Записи менеджера (localStorage) ----------
  // MVP: храним массив записей по каждому лиду в localStorage. Аудио — base64
  // data URL (FileReader.readAsDataURL). Реалистичные размеры: mp3 64kbps на
  // 5 минут ≈ 2 МБ. localStorage обычно ограничен ~5–10 МБ на origin —
  // помещается ~2–3 записи. Для production это переедет в Supabase Storage.
  const STORAGE_KEY = (leadId) => `mm_lead_recordings_v1__${leadId}`;
  const MAX_AUDIO_BYTES = 4 * 1024 * 1024; // 4 МБ — лимит на один файл

  function loadRecordings(leadId) {
    try {
      const raw = localStorage.getItem(STORAGE_KEY(leadId));
      if (!raw) return [];
      const arr = JSON.parse(raw);
      return Array.isArray(arr) ? arr : [];
    } catch (e) {
      return [];
    }
  }

  function saveRecordings(leadId, list) {
    try {
      localStorage.setItem(STORAGE_KEY(leadId), JSON.stringify(list));
      return true;
    } catch (e) {
      // Quota exceeded — даём знать менеджеру, что место кончилось.
      toast('Не хватает места в браузере (MVP-ограничение). Удалите старую запись.');
      return false;
    }
  }

  function toast(msg) {
    const t = document.getElementById('toast');
    if (!t) return;
    t.textContent = msg;
    t.classList.remove('hidden');
    clearTimeout(toast._t);
    toast._t = setTimeout(() => t.classList.add('hidden'), 2400);
  }

  // ---------- Утилиты ----------

  function escapeHtml(s) {
    return String(s ?? '').replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
  }

  function tgUrl(handle) {
    const h = handle.replace(/^@/, '');
    return `https://t.me/${encodeURIComponent(h)}`;
  }

  // Преобразует «+7 (495) 555-12-34» в «tel:+74955551234».
  function telHref(phone) {
    return 'tel:' + String(phone || '').replace(/[^\d+]/g, '');
  }

  const MONTHS_SHORT = ['янв', 'фев', 'мар', 'апр', 'мая', 'июн',
                        'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];
  const MONTHS_FULL = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня',
                       'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
  const WEEKDAYS_FULL = ['воскресенье', 'понедельник', 'вторник', 'среда',
                         'четверг', 'пятница', 'суббота'];

  function pad2(n) { return String(n).padStart(2, '0'); }

  function formatMeetingShort(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    const wd = WEEKDAYS_SHORT_RU[d.getDay()];
    return `${wd} ${d.getDate()} ${MONTHS_SHORT[d.getMonth()]}, ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
  }

  // Лид считается онлайн-встречей, если оператор поставил чекбокс
  // «Онлайн-встреча» — тогда meeting_address=null, а city хранит город встречи.
  function isOnlineLead(lead) {
    return !lead.meeting_address && !!lead.city;
  }

  function formatMeetingFull(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    return `${WEEKDAYS_FULL[d.getDay()]}, ${d.getDate()} ${MONTHS_FULL[d.getMonth()]} ${d.getFullYear()}, ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
  }

  // ---------- Рендер ----------

  function render() {
    const root = $('#leads-root');
    if (!root) return;
    if (view === 'detail') renderDetail(root);
    else renderBoard(root);
  }

  function renderBoard(root) {
    if (!LEADS.length) {
      root.innerHTML = '<div class="empty plain">Лидов пока нет.</div>';
      return;
    }
    const colsHtml = STATUS_COLUMNS.map((col) => {
      const items = LEADS
        .filter((l) => (l.status || 'meeting_scheduled') === col.key)
        .sort((a, b) => (b.lead_pos || 0) - (a.lead_pos || 0));
      const cards = items.length
        ? items.map(renderLeadCard).join('')
        : '<div class="lead-col-empty">— пусто —</div>';
      return `
        <div class="lead-col" data-col="${col.key}">
          <div class="lead-col-head">
            <span class="lead-col-title">${escapeHtml(col.title)}</span>
            <span class="lead-col-count">${items.length}</span>
          </div>
          <div class="lead-col-body" data-col="${col.key}">
            ${cards}
          </div>
        </div>`;
    }).join('');
    root.innerHTML = `<div class="leads-board" id="leads-board">${colsHtml}</div>`;
    bindBoardInteractions(root);
  }

  function renderLeadCard(lead) {
    const isOnline = isOnlineLead(lead);
    const kindCls = isOnline ? 'lead-card-online' : 'lead-card-offline';
    // Только улица + дом для офлайн; для онлайна — пусто (цвет сообщает тип).
    const where = isOnline ? '' : shortAddress(lead.meeting_address);
    return `
      <div class="lead-card ${kindCls}" draggable="true" data-id="${escapeHtml(lead.id)}" data-status="${escapeHtml(lead.status || 'meeting_scheduled')}">
        <div class="lead-card-name">${escapeHtml(lead.company_name)}</div>
        <div class="lead-card-meta">
          <span class="lead-card-where">${escapeHtml(where)}</span>
          <span class="lead-card-meet">${escapeHtml(formatMeetingShort(lead.meeting_at))}</span>
        </div>
      </div>`;
  }

  // Из полного адреса DaData оставляем только улицу и номер дома —
  // всё остальное (город, область, район, офис) на карточке не нужно.
  // Lookahead вместо \b — потому что в JS regex \b работает по ASCII \w
  // и не понимает кириллицу как «word», из-за чего ^ул\b не матчит «ул …».
  function shortAddress(addr) {
    if (!addr) return '';
    const STREET_RE = /^(?:ул|улица|пер|переулок|пр-кт|пр-т|проспект|пр|наб|набережная|ш|шоссе|пл|площадь|б-р|бульвар|тупик|тракт|аллея|проезд|линия|км|мкр|микрорайон)(?=\s|\.|$)/i;
    const HOUSE_RE = /^(?:д|дом|к|корпус|стр|строение|лит|литер|вл|владение)(?=\s|\.|$)\s*\d/i;
    const parts = addr.split(',').map((s) => s.trim()).filter(Boolean);
    const kept = parts.filter((p) => STREET_RE.test(p) || HOUSE_RE.test(p));
    return kept.length ? kept.join(', ') : addr;
  }

  function bindBoardInteractions(root) {
    let dragId = null;
    root.querySelectorAll('.lead-card[data-id]').forEach((card) => {
      card.addEventListener('click', () => openLeadInternal(card.dataset.id));
      card.addEventListener('dragstart', (e) => {
        dragId = card.dataset.id;
        e.dataTransfer.setData('text/plain', dragId);
        e.dataTransfer.effectAllowed = 'move';
        card.classList.add('lead-card-dragging');
      });
      card.addEventListener('dragend', () => {
        dragId = null;
        card.classList.remove('lead-card-dragging');
        root.querySelectorAll('.lead-col-body.lead-col-over').forEach((el) =>
          el.classList.remove('lead-col-over'));
      });
    });
    root.querySelectorAll('.lead-col-body').forEach((body) => {
      body.addEventListener('dragover', (e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        body.classList.add('lead-col-over');
      });
      body.addEventListener('dragleave', () => body.classList.remove('lead-col-over'));
      body.addEventListener('drop', async (e) => {
        e.preventDefault();
        body.classList.remove('lead-col-over');
        const id = dragId || e.dataTransfer.getData('text/plain');
        const newStatus = body.dataset.col;
        if (!id || !newStatus) return;
        await moveLeadTo(id, newStatus, body, e.clientY);
      });
    });
  }

  function dropIndexFromY(body, draggedId, clientY) {
    const cards = [...body.querySelectorAll('.lead-card[data-id]')]
      .filter((c) => c.dataset.id !== draggedId);
    for (let i = 0; i < cards.length; i++) {
      const r = cards[i].getBoundingClientRect();
      if (clientY < r.top + r.height / 2) return i;
    }
    return cards.length;
  }
  function calcLeadPos(neighbors, index) {
    if (!neighbors.length) return Date.now() / 1000;
    const above = index > 0 ? (neighbors[index - 1].lead_pos || 0) : null;
    const below = index < neighbors.length ? (neighbors[index].lead_pos || 0) : null;
    if (above === null) return below + 1;
    if (below === null) return above - 1;
    return (above + below) / 2;
  }

  async function moveLeadTo(leadId, newStatus, body, clientY) {
    const lead = LEADS.find((l) => l.id === leadId);
    if (!lead) return;

    const neighbors = LEADS
      .filter((l) => (l.status || 'meeting_scheduled') === newStatus && l.id !== leadId)
      .sort((a, b) => (b.lead_pos || 0) - (a.lead_pos || 0));
    const idx = dropIndexFromY(body, leadId, clientY);
    const newPos = calcLeadPos(neighbors, idx);
    if (lead.status === newStatus && (lead.lead_pos || 0) === newPos) return;

    const prev = { status: lead.status, lead_pos: lead.lead_pos };
    lead.status = newStatus;
    lead.lead_pos = newPos;
    render();
    const { error } = await sb.from('leads')
      .update({ status: newStatus, lead_pos: newPos })
      .eq('id', leadId);
    if (error) {
      console.error('lead move:', error);
      lead.status = prev.status;
      lead.lead_pos = prev.lead_pos;
      render();
      toast('Не получилось переместить: ' + (error.message || 'ошибка'));
    }
  }

  function openLeadInternal(id) {
    activeId = id;
    view = 'detail';
    render();
  }

  function renderDetail(root) {
    const lead = LEADS.find((l) => l.id === activeId);
    if (!lead) {
      view = 'board';
      render();
      return;
    }
    const fld = (label, valueHtml) => `
      <div class="lead-row">
        <dt>${label}</dt>
        <dd>${valueHtml}</dd>
      </div>`;
    const link = (url, label) => url
      ? `<a href="${escapeHtml(url)}" target="_blank" rel="noopener">${escapeHtml(label || url)}</a>`
      : `<span class="lead-no">— нет</span>`;

    const phoneCell = lead.phone
      ? `<a href="${escapeHtml(telHref(lead.phone))}" class="lead-phone">${escapeHtml(lead.phone)}</a>` +
        (lead.lpr_name ? ` <span class="lead-lpr">(ЛПР: ${escapeHtml(lead.lpr_name)})</span>` : '')
      : '<span class="lead-no">— нет</span>' +
        (lead.lpr_name ? ` <span class="lead-lpr">(ЛПР: ${escapeHtml(lead.lpr_name)})</span>` : '');

    const loyaltyCell = lead.has_loyalty
      ? `<span class="lead-yes">есть</span>` +
        (lead.loyalty_description ? ` — <span class="lead-loyal-descr">${escapeHtml(lead.loyalty_description)}</span>` : '')
      : '<span class="lead-no">— нет</span>';

    const meetingHtml = lead.meeting_at
      ? `<div class="lead-meeting-when">${escapeHtml(formatMeetingFull(lead.meeting_at))}</div>
         <div class="lead-meeting-where">${escapeHtml(lead.meeting_address ? shortAddress(lead.meeting_address) : '— адрес не указан')}</div>
         ${lead.meeting_address_note ? `<div class="lead-meeting-note">📌 ${escapeHtml(lead.meeting_address_note)}</div>` : ''}`
      : '<span class="lead-no">— встреча не назначена</span>';

    const hasPitch = Array.isArray(lead.pitch) && lead.pitch.length;
    const hasRecs = Array.isArray(lead.recommendations) && lead.recommendations.length;
    const hasDemo = Array.isArray(lead.demo_intro) && lead.demo_intro.length;
    const hasCall = lead.operator_call &&
      ((Array.isArray(lead.operator_call.transcript) && lead.operator_call.transcript.length)
        || lead.operator_call.audio_url);

    const pitchHtml = hasPitch
      ? `<div class="lead-pitch">
           ${lead.pitch.map((p) => `<p class="lead-pitch-p">${escapeHtml(p)}</p>`).join('')}
         </div>`
      : '';

    // Кнопка демо имеет смысл только если есть demo_intro или pitch — иначе
    // demo.html не покажет ничего осмысленного для свежего лида от оператора.
    const demoBtnHtml = (hasDemo || hasPitch)
      ? `<a class="btn primary lead-demo-btn" href="demo?lead=${encodeURIComponent(lead.id)}" target="_blank" rel="noopener">
           🖥 Демонстрация для клиента
         </a>`
      : '';

    // Секция «Рекомендации к встрече» — показываем если есть хоть что-то
    // (pitch / recs / demo). Для лида сразу после оператора — скрываем целиком,
    // чтобы менеджер не видел пустую болванку «Инструментов пока нет».
    const recsSectionHtml = (hasPitch || hasRecs || hasDemo)
      ? `<div class="lead-recs-header">
           <h3 class="lead-section-title">Рекомендации к встрече</h3>
           ${demoBtnHtml}
         </div>
         ${pitchHtml}
         ${hasRecs ? `<h4 class="lead-tools-subtitle">Инструменты для презентации</h4>${renderRecommendations(lead.recommendations)}` : ''}`
      : '';

    const commentHtml = lead.comment
      ? `<div class="lead-operator-comment">
           <div class="lead-operator-comment-label">💬 Комментарий оператора</div>
           <div class="lead-operator-comment-text">${escapeHtml(lead.comment)}</div>
         </div>`
      : '';

    const isOnline = isOnlineLead(lead);
    const kindBannerHtml = isOnline
      ? '<div class="lead-kind-banner lead-kind-online">🌐 Онлайн-встреча</div>'
      : '<div class="lead-kind-banner lead-kind-offline">📍 Офлайн-встреча</div>';

    root.innerHTML = `
      <div class="leads-detail-head">
        <button type="button" class="btn lead-back-btn" id="lead-back-btn">← К доске</button>
      </div>
      <div class="leads-detail-body">
        <h2 class="lead-detail-title">${escapeHtml(lead.company_name)}</h2>
        ${kindBannerHtml}

        <div class="lead-meeting-card${isOnline ? ' lead-meeting-card-online' : ''}">
          <div class="lead-meeting-label">📅 Встреча</div>
          ${meetingHtml}
        </div>

        <dl class="lead-fields">
          ${fld('Город', escapeHtml(lead.city || '— не указан'))}
          ${fld('Телефон', phoneCell)}
          ${lead._operator_name ? fld('Оператор', escapeHtml(lead._operator_name)) : ''}
          ${fld('Своя программа лояльности', loyaltyCell)}
          ${fld('Сайт', link(lead.website, lead.website))}
          ${fld('Telegram-канал', lead.telegram ? link(tgUrl(lead.telegram), lead.telegram) : '<span class="lead-no">— нет</span>')}
        </dl>

        ${commentHtml}

        ${recsSectionHtml}

        ${hasCall ? renderOperatorCall(lead) : ''}

        ${renderManagerRecordingsBlock(lead.id)}
      </div>`;

    document.getElementById('lead-back-btn')?.addEventListener('click', () => {
      view = 'board';
      activeId = null;
      render();
    });
    if (hasCall) bindCallTabs();
    bindManagerRecordings(lead);
  }

  // ---------- Звонок оператора (транскрибация + аудио) ----------

  function renderOperatorCall(lead) {
    const oc = lead.operator_call || { transcript: [], audio_url: '' };
    const clientLabel = (lead.lpr_name || '').split(',')[0] || 'Клиент';

    const transcriptHtml = (oc.transcript && oc.transcript.length)
      ? `<div class="call-transcript">${oc.transcript.map((line) => `
          <div class="call-line call-line-${line.speaker === 'op' ? 'op' : 'client'}">
            <span class="call-speaker">${line.speaker === 'op' ? 'Оператор' : escapeHtml(clientLabel)}:</span>
            <span class="call-text">${escapeHtml(line.text || '')}</span>
          </div>
        `).join('')}</div>`
      : '<div class="call-empty">Транскрибация пока не загружена.</div>';

    const audioHtml = oc.audio_url
      ? `<audio class="call-audio" controls preload="none" src="${escapeHtml(oc.audio_url)}"></audio>`
      : `<div class="call-empty">
           Запись звонка пока не подгружена.
           <span class="call-empty-hint">Оператор загрузит файл после звонка.</span>
         </div>`;

    const tab = activeCallTab === 'audio' ? 'audio' : 'transcript';

    return `
      <h3 class="lead-section-title lead-call-title">Звонок оператора</h3>
      <div class="lead-call">
        <div class="lead-tabs" role="tablist">
          <button class="lead-tab${tab === 'transcript' ? ' active' : ''}" data-tab="transcript" type="button" role="tab">
            📝 Транскрибация
          </button>
          <button class="lead-tab${tab === 'audio' ? ' active' : ''}" data-tab="audio" type="button" role="tab">
            🎙 Запись звонка
          </button>
        </div>
        <div class="lead-tab-pane" data-pane="transcript"${tab !== 'transcript' ? ' hidden' : ''}>
          ${transcriptHtml}
        </div>
        <div class="lead-tab-pane" data-pane="audio"${tab !== 'audio' ? ' hidden' : ''}>
          ${audioHtml}
        </div>
      </div>`;
  }

  function bindCallTabs() {
    const tabs = document.querySelectorAll('.lead-call .lead-tab');
    tabs.forEach((btn) => {
      btn.addEventListener('click', () => {
        const target = btn.dataset.tab;
        activeCallTab = target;
        tabs.forEach((b) => b.classList.toggle('active', b.dataset.tab === target));
        document.querySelectorAll('.lead-call .lead-tab-pane').forEach((p) => {
          p.hidden = (p.dataset.pane !== target);
        });
      });
    });
  }

  // ---------- Записи менеджера (после встречи) ----------

  function renderManagerRecordingsBlock(leadId) {
    return `
      <h3 class="lead-section-title lead-mgr-title">Мои записи и комментарии</h3>
      <p class="lead-mgr-hint">
        После встречи можно прикрепить аудиозапись разговора и комментарий.
        Каждая запись сохраняется отдельно.
      </p>
      <div id="lead-mgr-list" class="lead-mgr-list" data-lead-id="${escapeHtml(leadId)}"></div>
      <form class="lead-mgr-add" id="lead-mgr-add" autocomplete="off">
        <label class="lead-mgr-file">
          <input type="file" accept="audio/*" id="lead-mgr-file-input" hidden>
          <span class="btn lead-mgr-file-btn" id="lead-mgr-file-btn">📎 Выбрать аудиофайл</span>
          <span class="lead-mgr-file-name" id="lead-mgr-file-name">файл не выбран</span>
        </label>
        <textarea id="lead-mgr-comment" rows="3" placeholder="Комментарий к записи: что обсудили, что договорились, какие следующие шаги…"></textarea>
        <div class="lead-mgr-actions">
          <button class="btn primary" id="lead-mgr-add-btn" type="button">＋ Добавить запись</button>
          <span class="lead-mgr-add-hint">Файл до 4 МБ, mp3 / m4a / wav. Можно добавить только комментарий без аудио.</span>
        </div>
      </form>`;
  }

  function bindManagerRecordings(lead) {
    renderManagerRecordingsList(lead.id);

    const fileInput = document.getElementById('lead-mgr-file-input');
    const fileBtn = document.getElementById('lead-mgr-file-btn');
    const fileNameEl = document.getElementById('lead-mgr-file-name');
    const commentEl = document.getElementById('lead-mgr-comment');
    const addBtn = document.getElementById('lead-mgr-add-btn');

    if (!fileInput || !fileBtn || !addBtn) return;

    let pickedFile = null;

    fileBtn.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', () => {
      const f = fileInput.files && fileInput.files[0];
      if (!f) {
        pickedFile = null;
        fileNameEl.textContent = 'файл не выбран';
        return;
      }
      if (f.size > MAX_AUDIO_BYTES) {
        toast('Файл больше 4 МБ — выберите более короткий или с меньшим битрейтом.');
        fileInput.value = '';
        pickedFile = null;
        fileNameEl.textContent = 'файл не выбран';
        return;
      }
      pickedFile = f;
      fileNameEl.textContent = `${f.name} · ${formatBytes(f.size)}`;
    });

    addBtn.addEventListener('click', async () => {
      const comment = (commentEl.value || '').trim();
      if (!pickedFile && !comment) {
        toast('Прикрепите файл или напишите комментарий.');
        return;
      }
      addBtn.disabled = true;
      try {
        const dataUrl = pickedFile ? await readFileAsDataUrl(pickedFile) : '';
        const list = loadRecordings(lead.id);
        list.unshift({
          id: cryptoId(),
          uploaded_at: new Date().toISOString(),
          file_name: pickedFile ? pickedFile.name : '',
          file_size: pickedFile ? pickedFile.size : 0,
          mime: pickedFile ? pickedFile.type : '',
          data_url: dataUrl,
          comment,
        });
        const ok = saveRecordings(lead.id, list);
        if (ok) {
          // Сбрасываем форму.
          fileInput.value = '';
          pickedFile = null;
          fileNameEl.textContent = 'файл не выбран';
          commentEl.value = '';
          renderManagerRecordingsList(lead.id);
          toast('Запись добавлена.');
        }
      } catch (e) {
        toast('Не получилось прочитать файл.');
      } finally {
        addBtn.disabled = false;
      }
    });
  }

  function renderManagerRecordingsList(leadId) {
    const wrap = document.getElementById('lead-mgr-list');
    if (!wrap) return;
    const list = loadRecordings(leadId);
    if (!list.length) {
      wrap.innerHTML = '<div class="lead-mgr-empty">Записей пока нет. Прикрепите первую — после встречи.</div>';
      return;
    }
    wrap.innerHTML = list.map((rec) => `
      <div class="lead-mgr-card" data-rec-id="${escapeHtml(rec.id)}">
        <div class="lead-mgr-card-head">
          <span class="lead-mgr-when">${escapeHtml(formatRecordingTime(rec.uploaded_at))}</span>
          <button class="btn lead-mgr-del" type="button" data-rec-id="${escapeHtml(rec.id)}" title="Удалить запись">🗑</button>
        </div>
        ${rec.data_url ? `
          <audio class="lead-mgr-audio" controls preload="none" src="${escapeHtml(rec.data_url)}"></audio>
          <div class="lead-mgr-filename">${escapeHtml(rec.file_name || 'аудиозапись')} · ${formatBytes(rec.file_size || 0)}</div>
        ` : ''}
        ${rec.comment ? `<div class="lead-mgr-comment">${escapeHtml(rec.comment)}</div>` : ''}
      </div>
    `).join('');
    wrap.querySelectorAll('.lead-mgr-del').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const ok = window.confirmDialog
          ? await window.confirmDialog({
              title: 'Удалить запись?',
              message: 'Аудио и комментарий будут удалены безвозвратно.',
              okText: 'Удалить',
              cancelText: 'Отмена',
              danger: true,
            })
          : confirm('Удалить запись?');
        if (!ok) return;
        const recId = btn.dataset.recId;
        const list2 = loadRecordings(leadId).filter((r) => r.id !== recId);
        if (saveRecordings(leadId, list2)) {
          renderManagerRecordingsList(leadId);
          toast('Запись удалена.');
        }
      });
    });
  }

  // ---------- Утилиты для записей менеджера ----------

  function readFileAsDataUrl(file) {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result || ''));
      r.onerror = () => reject(r.error);
      r.readAsDataURL(file);
    });
  }

  function cryptoId() {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
    return 'r_' + Math.random().toString(36).slice(2, 12) + Date.now().toString(36);
  }

  function formatBytes(bytes) {
    if (!bytes) return '0 Б';
    if (bytes < 1024) return `${bytes} Б`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} КБ`;
    return `${(bytes / 1024 / 1024).toFixed(1)} МБ`;
  }

  function formatRecordingTime(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    return `${d.getDate()} ${MONTHS_FULL[d.getMonth()]} ${d.getFullYear()}, ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
  }

  function renderRecommendations(recs) {
    if (!Array.isArray(recs) || !recs.length) {
      return '<div class="lead-recs-empty">Инструментов пока нет.</div>';
    }
    return `
      <div class="lead-recs">
        ${recs.map((block) => `
          <div class="lead-rec-block">
            <div class="lead-rec-title">${escapeHtml(block.category || '')}</div>
            <ul class="lead-rec-items">
              ${(block.items || []).map((it) => `
                <li class="lead-rec-item">
                  <span class="lead-rec-tool">${escapeHtml(it.tool || '')}</span>
                  <span class="lead-rec-benefit">${escapeHtml(it.benefit || '')}</span>
                </li>
              `).join('')}
            </ul>
          </div>
        `).join('')}
      </div>`;
  }

  async function loadLeads() {
    const { data: { user } } = await sb.auth.getUser();
    if (!user) return;
    // RLS уже фильтрует по manager_id = auth.uid(), но дублируем явно для прозрачности.
    // Сортируем по lead_pos DESC (ручной порядок в канбане), затем created_at.
    const { data, error } = await sb
      .from('leads')
      .select('*')
      .eq('manager_id', user.id)
      .order('lead_pos', { ascending: false, nullsFirst: false })
      .order('created_at', { ascending: false });
    if (error) {
      console.error('seller-leads load:', error);
      LEADS = [];
      return;
    }
    LEADS = (data || []).map(normalizeLead);
    // Догружаем имена операторов одним запросом (RLS «users select operators»
    // из migration_27 — открыт только для роли operator).
    const opIds = [...new Set(LEADS.map((l) => l.operator_id).filter(Boolean))];
    if (opIds.length) {
      const { data: ops, error: opsErr } = await sb
        .from('users')
        .select('id, full_name, email')
        .in('id', opIds);
      if (opsErr) console.warn('operators load:', opsErr);
      const map = Object.fromEntries((ops || []).map((o) => [o.id, o]));
      LEADS.forEach((l) => {
        const op = map[l.operator_id];
        l._operator_name = op ? ((op.full_name || '').trim() || op.email || '') : '';
      });
    }
  }

  // Поля pitch/demo_intro/recommendations/operator_call хранятся как jsonb;
  // у свежих лидов от оператора они null — приводим к ожидаемым формам.
  function normalizeLead(row) {
    return {
      ...row,
      pitch: Array.isArray(row.pitch) ? row.pitch : [],
      demo_intro: Array.isArray(row.demo_intro) ? row.demo_intro : [],
      recommendations: Array.isArray(row.recommendations) ? row.recommendations : [],
      operator_call: row.operator_call && typeof row.operator_call === 'object'
        ? row.operator_call
        : { audio_url: '', transcript: [] },
    };
  }

  // Внешний API
  // — show(): вызывается при переходе на вкладку «Мои лиды» (seller.html
  //   биндит клик по seller-tab[data-section=leads]). Перезагружает данные
  //   и рендерит текущий вид. За счёт этого drag-drop оператора виден у
  //   менеджера сразу при возврате на вкладку.
  // — openLead(id): вызывается из календаря через клик «Мои лиды → ‹карточка›».
  //   Переключает в detail-режим и открывает указанный лид.
  let pendingOpenId = null;
  let initialized = false;
  window.sellerLeads = {
    async show() {
      if (!initialized) {
        initialized = true;
        await loadLeads();
        if (pendingOpenId) { activeId = pendingOpenId; view = 'detail'; pendingOpenId = null; }
      } else {
        // Обновляем доску из БД (могли прилететь правки от оператора).
        await loadLeads();
      }
      render();
    },
    async openLead(id) {
      if (!id) return;
      if (initialized && LEADS.length) {
        activeId = id;
        view = 'detail';
        render();
      } else {
        pendingOpenId = id;
        // show() возьмёт pendingOpenId после loadLeads.
      }
    },
  };

  document.addEventListener('DOMContentLoaded', async () => {
    const root = $('#leads-root');
    if (!root) return;
    root.innerHTML = '<div class="empty plain">Загрузка…</div>';
    initialized = true;
    await loadLeads();
    if (pendingOpenId) { activeId = pendingOpenId; view = 'detail'; pendingOpenId = null; }
    render();
  });

  // При возврате во вкладку браузера — обновляем доску, чтобы увидеть свежие
  // изменения статусов от оператора (без честного realtime/WS).
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return;
    const section = document.getElementById('section-leads');
    if (!section || section.hidden) return;
    loadLeads().then(() => { if (view === 'board') render(); });
  });
})();
