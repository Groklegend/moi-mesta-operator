// Раздел «Мои лиды» — лиды от операторов холодных звонков, ждут встречи
// с менеджером. Данные берутся из window.LEADS_DATA (js/leads-data.js).

(function () {
  'use strict';

  const LEADS = Array.isArray(window.LEADS_DATA) ? window.LEADS_DATA : [];

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
  const WEEKDAYS_FULL = ['воскресенье', 'понедельник', 'вторник', 'среда',
                         'четверг', 'пятница', 'суббота'];

  function pad2(n) { return String(n).padStart(2, '0'); }

  function formatMeetingShort(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    return `${d.getDate()} ${MONTHS_SHORT[d.getMonth()]}, ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
  }

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
         <div class="lead-meeting-where">${escapeHtml(lead.meeting_address || '— адрес не указан')}</div>`
      : '<span class="lead-no">— встреча не назначена</span>';

    const pitchHtml = Array.isArray(lead.pitch) && lead.pitch.length
      ? `<div class="lead-pitch">
           ${lead.pitch.map((p) => `<p class="lead-pitch-p">${escapeHtml(p)}</p>`).join('')}
         </div>`
      : '';

    const demoUrl = `demo.html?lead=${encodeURIComponent(lead.id)}`;

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

      <div class="lead-recs-header">
        <h3 class="lead-section-title">Рекомендации к встрече</h3>
        <a class="btn primary lead-demo-btn" href="${demoUrl}" target="_blank" rel="noopener">
          🖥 Демонстрация для клиента
        </a>
      </div>

      ${pitchHtml}

      <h4 class="lead-tools-subtitle">Инструменты для презентации</h4>
      ${renderRecommendations(lead.recommendations)}`;
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

  document.addEventListener('DOMContentLoaded', () => {
    renderList();
    renderPane();
  });
})();
