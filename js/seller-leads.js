// Раздел «Мои лиды» — лиды, которые оператор холодных звонков уже
// квалифицировал и согласовал встречу. Менеджер готовится к встрече
// и проводит её. На старте — моковые данные, подключение к таблице
// `leads` в Supabase — отдельной задачей.

(function () {
  'use strict';

  const LEADS = [
    {
      id: '1',
      company_name: 'Ресторан «Облака»',
      city: 'Москва',
      phone: '+7 (495) 555-12-34',
      lpr_name: 'Светлана Морозова, владелица',
      has_loyalty: true,
      loyalty_description: 'Простой кэшбэк через iiko: 5% от чека возвращается на счёт клиента, без порогов и сроков сгорания.',
      website: 'https://oblaka-rest.ru',
      telegram: '@oblaka_rest',
      meeting_at: '2026-01-15T12:30:00+03:00',
      meeting_address: 'Москва, ул. Тверская, 12, офис 4 (БЦ «Тверской»)',
      recommendations: [
        {
          category: 'Удержание действующих клиентов',
          items: [
            { tool: 'Накопительная+ с порогами от 10 000 ₽', benefit: '+25% к повторным визитам' },
            { tool: 'Сегментация VIP-гостей через iiko', benefit: '+12% к среднему чеку' },
          ],
        },
        {
          category: 'Привлечение новых клиентов',
          items: [
            { tool: 'Реферальная программа «Приведи друга»', benefit: '4–6 новых гостей/нед' },
            { tool: 'UGC-кампания через Telegram-канал', benefit: '+8% узнаваемости в районе' },
          ],
        },
      ],
    },
    {
      id: '2',
      company_name: 'Стоматология «Зубики»',
      city: 'Санкт-Петербург',
      phone: '',
      lpr_name: 'Игорь Васильев, главный врач и собственник',
      has_loyalty: false,
      loyalty_description: '',
      website: 'https://zubiki.clinic',
      telegram: '',
      meeting_at: '2026-01-16T10:00:00+03:00',
      meeting_address: 'Санкт-Петербург, Невский пр., 88, кабинет главврача',
      recommendations: [
        {
          category: 'Удержание действующих клиентов',
          items: [
            { tool: 'Бонусная программа: 5% от чека', benefit: '+18% к LTV пациента' },
            { tool: 'SMS-напоминания о профчистке (6 мес)', benefit: 'возврат 35% «уснувших» пациентов' },
          ],
        },
        {
          category: 'Привлечение новых клиентов',
          items: [
            { tool: 'Сертификаты на консультацию для родственников', benefit: '2–4 новых пациента/мес' },
            { tool: 'Партнёрство с офисами рядом (Невский 88)', benefit: '5–8 первичных приёмов/мес' },
          ],
        },
      ],
    },
    {
      id: '3',
      company_name: 'Салон «Аура Красоты»',
      city: 'Санкт-Петербург',
      phone: '+7 (812) 333-22-11',
      lpr_name: 'Ирина Соколова, директор сети',
      has_loyalty: true,
      loyalty_description: 'Программа в YClients: накопительная скидка с порогами 5% / 10% / 15% по сумме покупок за год. Балансы клиентов хранятся на стороне YClients.',
      website: '',
      telegram: '@aura_beauty_spb',
      meeting_at: '2026-01-17T15:00:00+03:00',
      meeting_address: 'Санкт-Петербург, ул. Рубинштейна, 23, 2 этаж',
      recommendations: [
        {
          category: 'Удержание действующих клиентов',
          items: [
            { tool: 'Параллельный канал в Telegram-боте', benefit: '+15% к частоте визитов' },
            { tool: 'Сквозная аналитика iiko + наш модуль', benefit: 'отток виден за 30 дней до ухода' },
          ],
        },
        {
          category: 'Привлечение новых клиентов',
          items: [
            { tool: 'Гостевые карты на пробную услугу', benefit: '3–5 новых клиенток/мес' },
            { tool: 'Реферальные бонусы в YClients', benefit: '+6% к новой клиентской базе/квартал' },
          ],
        },
      ],
    },
    {
      id: '4',
      company_name: 'Кофейня «Утро»',
      city: 'Казань',
      phone: '+7 (999) 888-77-66',
      lpr_name: 'Александр Петров, собственник',
      has_loyalty: false,
      loyalty_description: '',
      website: 'https://utro-coffee.ru',
      telegram: '',
      meeting_at: '2026-01-19T11:00:00+03:00',
      meeting_address: 'Казань, ул. Баумана, 15, точка №1 (флагман)',
      recommendations: [
        {
          category: 'Удержание действующих клиентов',
          items: [
            { tool: 'Скидочная классика 7% от 5-й покупки', benefit: '+22% к повторным визитам' },
            { tool: 'Бонусный напиток в день рождения', benefit: '+12% к выручке за квартал' },
          ],
        },
        {
          category: 'Привлечение новых клиентов',
          items: [
            { tool: 'Кросс-промо с соседними бизнесами на Баумана', benefit: '50–80 новых гостей/мес' },
            { tool: 'Реферальная фишка «друг за кофе»', benefit: '3–5 новых клиентов/нед' },
          ],
        },
      ],
    },
    {
      id: '5',
      company_name: 'Барбершоп «Усы»',
      city: 'Москва',
      phone: '+7 (903) 200-15-15',
      lpr_name: 'Дмитрий Орлов, владелец',
      has_loyalty: true,
      loyalty_description: 'Бумажные карточки лояльности: каждая 11-я стрижка бесплатно (отметки руками). Учёт ведётся вручную, без CRM.',
      website: 'https://usy-barber.ru',
      telegram: '@usy_barber',
      meeting_at: '2026-01-20T17:00:00+03:00',
      meeting_address: 'Москва, ул. Маросейка, 7, барбершоп (1 этаж)',
      recommendations: [
        {
          category: 'Модернизация учёта',
          items: [
            { tool: 'Замена бумажных карт на цифровую программу', benefit: 'экономия 8 ч/нед админа' },
            { tool: 'Автоматический учёт визитов (QR-чек)', benefit: '+30% к точности учёта' },
          ],
        },
        {
          category: 'Удержание действующих клиентов',
          items: [
            { tool: 'Рассылки через Telegram-бот', benefit: '+14% к частоте визитов' },
            { tool: 'Бонус ко дню рождения мастера-фаворита', benefit: '+9% к среднему чеку' },
          ],
        },
        {
          category: 'Привлечение новых клиентов',
          items: [
            { tool: 'Реферальная программа в TG-канале', benefit: '6–10 новых клиентов/мес' },
          ],
        },
      ],
    },
  ];

  const $ = (sel, el = document) => el.querySelector(sel);

  let activeId = null;

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
  const WEEKDAYS_SHORT = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'];
  const WEEKDAYS_FULL = ['воскресенье', 'понедельник', 'вторник', 'среда',
                         'четверг', 'пятница', 'суббота'];

  function pad2(n) { return String(n).padStart(2, '0'); }

  // «15 янв, 12:30» — для карточки в списке.
  function formatMeetingShort(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    return `${d.getDate()} ${MONTHS_SHORT[d.getMonth()]}, ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
  }

  // «вторник, 15 января 2026, 12:30» — для панели деталей.
  function formatMeetingFull(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    return `${WEEKDAYS_FULL[d.getDay()]}, ${d.getDate()} ${MONTHS_FULL[d.getMonth()]} ${d.getFullYear()}, ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
  }

  // ---------- Рендер ----------

  function renderList() {
    const list = $('#leads-list');
    if (!list) return;
    if (!LEADS.length) {
      list.innerHTML = '<div class="empty plain">Лидов пока нет.</div>';
      return;
    }
    list.innerHTML = LEADS.map((lead) => `
      <button class="lead-item${lead.id === activeId ? ' active' : ''}" data-id="${lead.id}" type="button">
        <div class="lead-name">${escapeHtml(lead.company_name)}</div>
        <div class="lead-meta">
          <span class="lead-city">${escapeHtml(lead.city || '')}</span>
          <span class="lead-meet">${escapeHtml(formatMeetingShort(lead.meeting_at))}</span>
        </div>
      </button>`).join('');
    list.querySelectorAll('.lead-item').forEach((b) => {
      b.addEventListener('click', () => {
        activeId = b.dataset.id;
        renderList();
        renderPane();
      });
    });
  }

  function renderPane() {
    const pane = $('#leads-pane');
    if (!pane) return;
    const lead = LEADS.find((l) => l.id === activeId);
    if (!lead) {
      pane.innerHTML = `
        <div class="placeholder">
          <span class="big-icon">📍</span>
          Выберите лид слева — описание появится здесь
        </div>`;
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

    // Телефон: кликабельная ссылка tel:, рядом — ЛПР в скобках.
    const phoneCell = lead.phone
      ? `<a href="${escapeHtml(telHref(lead.phone))}" class="lead-phone">${escapeHtml(lead.phone)}</a>` +
        (lead.lpr_name ? ` <span class="lead-lpr">(ЛПР: ${escapeHtml(lead.lpr_name)})</span>` : '')
      : '<span class="lead-no">— нет</span>' +
        (lead.lpr_name ? ` <span class="lead-lpr">(ЛПР: ${escapeHtml(lead.lpr_name)})</span>` : '');

    // Лояльность: «есть» + описание справа. Если нет — «— нет».
    const loyaltyCell = lead.has_loyalty
      ? `<span class="lead-yes">есть</span>` +
        (lead.loyalty_description ? ` — <span class="lead-loyal-descr">${escapeHtml(lead.loyalty_description)}</span>` : '')
      : '<span class="lead-no">— нет</span>';

    const meetingHtml = lead.meeting_at
      ? `<div class="lead-meeting-when">${escapeHtml(formatMeetingFull(lead.meeting_at))}</div>
         <div class="lead-meeting-where">${escapeHtml(lead.meeting_address || '— адрес не указан')}</div>`
      : '<span class="lead-no">— встреча не назначена</span>';

    pane.innerHTML = `
      <h2 class="lead-detail-title">${escapeHtml(lead.company_name)}</h2>

      <div class="lead-meeting-card">
        <div class="lead-meeting-label">📅 Встреча</div>
        ${meetingHtml}
      </div>

      <dl class="lead-fields">
        ${fld('Город', escapeHtml(lead.city || '— не указан'))}
        ${fld('Телефон', phoneCell)}
        ${fld('Своя программа лояльности', loyaltyCell)}
        ${fld('Сайт', link(lead.website, lead.website))}
        ${fld('Telegram-канал', lead.telegram ? link(tgUrl(lead.telegram), lead.telegram) : '<span class="lead-no">— нет</span>')}
      </dl>

      <h3 class="lead-section-title">Рекомендации к встрече</h3>
      ${renderRecommendations(lead.recommendations)}`;
  }

  function renderRecommendations(recs) {
    if (!Array.isArray(recs) || !recs.length) {
      return '<div class="lead-recs-empty">Рекомендаций пока нет.</div>';
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

  document.addEventListener('DOMContentLoaded', () => {
    renderList();
    renderPane();
  });
})();
