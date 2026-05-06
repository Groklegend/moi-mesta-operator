// Скрипт страницы demo.html — рендерит персональную презентацию
// для собственника бизнеса. Данные берутся из window.LEADS_DATA по
// параметру `?lead=<id>` в URL.
//
// ⚠️ MVP: сейчас лиды захардкожены и идентификаторы простые (1..5).
// При подключении к Supabase URL должен содержать токен с ограниченным
// сроком действия, иначе любой получатель ссылки сможет угадывать
// чужие лиды через ?lead=2, ?lead=3 и т.д.

(function () {
  'use strict';

  function escapeHtml(s) {
    return String(s ?? '').replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
  }

  const params = new URLSearchParams(location.search);
  const id = params.get('lead');
  const lead = (window.LEADS_DATA || []).find((l) => l.id === id);

  const titleEl = document.getElementById('demo-title');
  const eyebrowEl = document.getElementById('demo-eyebrow');
  const introEl = document.getElementById('demo-intro');
  const recsEl = document.getElementById('demo-recs');

  if (!lead) {
    if (titleEl) titleEl.textContent = 'Лид не найден';
    if (eyebrowEl) eyebrowEl.textContent = 'Ошибка';
    if (introEl) {
      introEl.innerHTML =
        '<p>Не удалось загрузить персональное предложение по ссылке. ' +
        'Уточните у менеджера актуальный URL.</p>';
    }
    if (recsEl) recsEl.innerHTML = '';
    return;
  }

  document.title = `Мои Места — программа для «${lead.company_name}»`;

  if (eyebrowEl) {
    eyebrowEl.textContent = lead.city
      ? `Персональное предложение · ${lead.city}`
      : 'Персональное предложение';
  }
  if (titleEl) {
    titleEl.textContent = `Программа для «${lead.company_name}»`;
  }

  if (introEl) {
    const paragraphs = Array.isArray(lead.demo_intro) ? lead.demo_intro : [];
    if (!paragraphs.length) {
      introEl.innerHTML = '<p>Подробное описание готовится.</p>';
    } else {
      introEl.innerHTML = paragraphs
        .map((p) => `<p>${escapeHtml(p)}</p>`)
        .join('');
    }
  }

  if (recsEl) {
    const recs = Array.isArray(lead.recommendations) ? lead.recommendations : [];
    if (!recs.length) {
      recsEl.innerHTML = '<p>Список инструментов готовится.</p>';
    } else {
      recsEl.innerHTML = recs.map((block) => `
        <div class="demo-rec-block">
          <h3 class="demo-rec-title">${escapeHtml(block.category || '')}</h3>
          <ul class="demo-rec-items">
            ${(block.items || []).map((it) => `
              <li class="demo-rec-item">
                <span class="demo-rec-tool">${escapeHtml(it.tool || '')}</span>
                <span class="demo-rec-benefit">${escapeHtml(it.benefit || '')}</span>
              </li>
            `).join('')}
          </ul>
        </div>
      `).join('');
    }
  }
})();
