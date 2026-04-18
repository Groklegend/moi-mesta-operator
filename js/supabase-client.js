// Единый клиент Supabase для всех страниц
const { createClient } = supabase;
const sb = createClient(window.SUPABASE_CONFIG.url, window.SUPABASE_CONFIG.anonKey);
window.sb = sb;

// Утилиты
window.escapeHtml = (s) => String(s ?? '')
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;')
  .replaceAll("'", '&#39;');

// Минимальное форматирование: **жирный**, * список, переносы строк
window.formatAnswer = (text) => {
  if (!text) return '';
  const lines = String(text).split('\n');
  const html = [];
  let inList = false;
  for (const raw of lines) {
    const line = raw.trimEnd();
    if (/^\s*[-*•]\s+/.test(line)) {
      if (!inList) { html.push('<ul>'); inList = true; }
      html.push('<li>' + applyInline(line.replace(/^\s*[-*•]\s+/, '')) + '</li>');
    } else {
      if (inList) { html.push('</ul>'); inList = false; }
      if (line === '') html.push('<br>');
      else html.push('<p>' + applyInline(line) + '</p>');
    }
  }
  if (inList) html.push('</ul>');
  return html.join('');
  function applyInline(s) {
    return escapeHtml(s).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  }
};

window.logEvent = async (payload) => {
  try { await sb.from('stats').insert(payload); } catch (e) { /* не блокируем UX */ }
};
