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
      recommendations:
        'Сильный поток гостей (~800/нед.), но текущая программа — простой кэшбэк ' +
        'через iiko. На встрече показать переход на «Накопительная+» с порогами от ' +
        '10 000 ₽: клиенту это даст сегментацию VIP-гостей, нам — вход через ' +
        'интеграцию iiko (шаг «Интеграция → после теста»). Подготовить расчёт ROI ' +
        'на их числах: 30% повторных визитов = +X к выручке.',
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
      recommendations:
        'CRM нет, базу ведут в Google Таблицах. На встрече сначала уточнить размер ' +
        'базы — если меньше 500 человек, классическая бонусная (5% от чека) ' +
        'с напоминаниями о профчистке. Если больше — добавить порог и SMS-сегменты. ' +
        'Главврач лично принимает решение, готовиться к разговору на медицинском ' +
        'языке (LTV пациента, retention).',
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
      recommendations:
        'Уже работают на YClients со встроенной программой лояльности. Наш плюс — ' +
        'сквозная аналитика по визитам через iiko + наш модуль. Гари подготовил ' +
        'план миграции базы с YClients (сохранение балансов клиентов) — взять ' +
        'распечатку. На встрече не предлагать замену — позиционировать как ' +
        'параллельный канал коммуникации с гостем.',
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
      recommendations:
        'Сеть из 3 точек, средний чек 350 ₽, частота визитов высокая. На встрече ' +
        'предложить «Скидочную классику» 7% от 5-й покупки. Собственник — Александр ' +
        'Петров, встреча в флагманской точке во время обеда. Принести бумажный ' +
        'кейс другой кофейни нашего же размера (+18% повторных за квартал).',
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
      recommendations:
        'Внешняя программа лояльности на бумажных карточках — устарело, главная ' +
        'боль владельца. Скрипт 2 (модернизация): сравнить трудоёмкость учёта руками ' +
        'vs автоматический бонус. Telegram-канал активен (посты 3 раза в неделю) — ' +
        'на встрече сразу предложить интеграцию рассылок через бот.',
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
      <div class="lead-recommendations">${escapeHtml(lead.recommendations)}</div>`;
  }

  document.addEventListener('DOMContentLoaded', () => {
    renderList();
    renderPane();
  });
})();
