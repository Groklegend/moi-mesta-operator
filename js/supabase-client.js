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

// HTML-контент с Quill опознаём по наличию тегов форматирования.
// Если есть — санитизируем через DOMPurify (если подключён) и отдаём как HTML.
// Иначе — старое markdown-рендеринг (обратная совместимость со старыми возражениями).
const HTML_MARKER_RE = /<(p|br|strong|em|b|i|u|s|ul|ol|li|span|h[1-6]|div|blockquote|a)\b/i;

window.formatAnswer = (text) => {
  if (!text) return '';
  const str = String(text);
  if (HTML_MARKER_RE.test(str)) {
    // HTML из rich-редактора
    if (typeof window.DOMPurify !== 'undefined') {
      return window.DOMPurify.sanitize(str, {
        ALLOWED_TAGS: ['p','br','strong','em','b','i','u','s','ul','ol','li','span','h1','h2','h3','h4','h5','h6','div','blockquote','a'],
        ALLOWED_ATTR: ['href','target','rel','class','style'],
      });
    }
    return str;
  }
  // Plain text с упрощённой markdown-разметкой
  const lines = str.split('\n');
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
  try {
    const s = window.operatorSession?.get?.();
    const row = s?.id ? { ...payload, operator_id: s.id } : payload;
    await sb.from('stats').insert(row);
  } catch (e) { /* не блокируем UX */ }
};
