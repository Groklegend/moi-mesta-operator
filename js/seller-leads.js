// Раздел «Мои лиды» — список компаний-кандидатов на холодный звонок
// и панель с рекомендациями для каждой. На старте — моковые данные.
// Подключение к таблице `leads` в Supabase — отдельной задачей.

(function () {
  'use strict';

  const LEADS = [
    {
      id: '1',
      company_name: 'Ресторан «Облака»',
      phone: '+7 (495) 555-12-34',
      has_loyalty: true,
      website: 'https://oblaka-rest.ru',
      telegram: '@oblaka_rest',
      recommendations:
        'Сильный поток гостей (~800/нед.), но текущая программа — простой кэшбэк ' +
        'через iiko. Предложить переход на «Накопительная+» с порогами от 10 000 ₽: ' +
        'клиенту это даст сегментацию VIP-гостей, а нам — вход через интеграцию iiko ' +
        '(шаг «Интеграция → после теста»). Скрипт 4 (возврат): акцент на 30% повторных ' +
        'визитов. Бонусом — UGC-кампания через Telegram-канал клиента.',
    },
    {
      id: '2',
      company_name: 'Стоматология «Зубики»',
      phone: '',
      has_loyalty: false,
      website: 'https://zubiki.clinic',
      telegram: '',
      recommendations:
        'CRM нет, базу ведут в Google Таблицах. Сначала уточнить размер базы — ' +
        'если меньше 500 человек, предложить классическую бонусную (5% от чека) ' +
        'с напоминаниями о профчистке через 6 мес. Если больше — добавить порог ' +
        'и SMS-сегменты. Телефона на сайте нет → искать ЛПР через 2GIS / контакт ' +
        'на странице вакансий.',
    },
    {
      id: '3',
      company_name: 'Салон «Аура Красоты»',
      phone: '+7 (812) 333-22-11',
      has_loyalty: true,
      website: '',
      telegram: '@aura_beauty_spb',
      recommendations:
        'Уже работают на YClients со встроенной программой лояльности. Наш плюс — ' +
        'сквозная аналитика по визитам через iiko + наш модуль. Гари готовит план ' +
        'миграции базы с YClients (сохранение балансов клиентов). На звонке ' +
        'не предлагать замену — только параллельный канал коммуникации с гостем.',
    },
    {
      id: '4',
      company_name: 'Кофейня «Утро»',
      phone: '+7 (999) 888-77-66',
      has_loyalty: false,
      website: 'https://utro-coffee.ru',
      telegram: '',
      recommendations:
        'Сеть из 3 точек, средний чек 350 ₽, частота визитов высокая. Подойдёт ' +
        '«Скидочная классика» 7% от 5-й покупки. На звонок отвечает бариста — ' +
        'спрашивать собственника напрямую (по сайту: Александр Петров). ' +
        'Лучшее время для звонка — 14:00–16:00 (обед закончился).',
    },
    {
      id: '5',
      company_name: 'Барбершоп «Усы»',
      phone: '+7 (903) 200-15-15',
      has_loyalty: true,
      website: 'https://usy-barber.ru',
      telegram: '@usy_barber',
      recommendations:
        'Внешняя программа лояльности на бумажных карточках — устарело. Хороший ' +
        'кандидат на полный переход к нам. Скрипт 2 (модернизация): сравнить ' +
        'трудоёмкость учёта руками vs автоматический бонус. Telegram-канал активен ' +
        '(посты 3 раза в неделю) → можно сразу предложить интеграцию рассылок.',
    },
  ];

  const $ = (sel, el = document) => el.querySelector(sel);

  let activeId = null;

  function escapeHtml(s) {
    return String(s ?? '').replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
  }

  function tgUrl(handle) {
    const h = handle.replace(/^@/, '');
    return `https://t.me/${encodeURIComponent(h)}`;
  }

  function renderList() {
    const list = $('#leads-list');
    if (!list) return;
    if (!LEADS.length) {
      list.innerHTML = '<div class="empty plain">Лидов пока нет — Гари ещё не загрузил базу.</div>';
      return;
    }
    list.innerHTML = LEADS.map((lead) => {
      const flags = [];
      if (lead.phone) flags.push('<span class="lead-flag has">☎ есть</span>');
      else flags.push('<span class="lead-flag no">☎ нет</span>');
      if (lead.has_loyalty) flags.push('<span class="lead-flag loyal">🎁 лояльность</span>');
      return `
        <button class="lead-item${lead.id === activeId ? ' active' : ''}" data-id="${lead.id}" type="button">
          <div class="lead-name">${escapeHtml(lead.company_name)}</div>
          <div class="lead-flags">${flags.join('')}</div>
        </button>`;
    }).join('');
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
    const yesNo = (val, yesText) =>
      val ? `<span class="lead-yes">✓ есть${yesText ? ' — ' + yesText : ''}</span>`
          : `<span class="lead-no">— нет</span>`;
    const link = (url, label) => url
      ? `<a href="${escapeHtml(url)}" target="_blank" rel="noopener">${escapeHtml(label || url)}</a>`
      : `<span class="lead-no">— нет</span>`;

    pane.innerHTML = `
      <h2 class="lead-detail-title">${escapeHtml(lead.company_name)}</h2>
      <dl class="lead-fields">
        ${fld('Телефон', yesNo(lead.phone, escapeHtml(lead.phone || '')))}
        ${fld('Своя программа лояльности', yesNo(lead.has_loyalty, ''))}
        ${fld('Сайт', link(lead.website, lead.website))}
        ${fld('Telegram-канал', lead.telegram ? link(tgUrl(lead.telegram), lead.telegram) : '<span class="lead-no">— нет</span>')}
      </dl>
      <h3 class="lead-section-title">Рекомендации для звонка</h3>
      <div class="lead-recommendations">${escapeHtml(lead.recommendations)}</div>`;
  }

  document.addEventListener('DOMContentLoaded', () => {
    renderList();
    renderPane();
  });
})();
