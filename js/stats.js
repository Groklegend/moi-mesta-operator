// ============================================================
// Страница статистики
// ============================================================

sb.auth.getSession().then(({ data }) => {
  if (!data?.session) location.replace('login.html');
  else loadStats('week');
});

document.getElementById('logout').addEventListener('click', async () => {
  await sb.auth.signOut();
  location.replace('login.html');
});

document.querySelectorAll('.stats-filters button').forEach(b => {
  b.addEventListener('click', () => {
    document.querySelectorAll('.stats-filters button').forEach(x => x.classList.remove('active'));
    b.classList.add('active');
    loadStats(b.dataset.range);
  });
});

let chartTop = null;
let chartDays = null;

function rangeToDate(range) {
  if (range === 'all') return null;
  const d = new Date();
  if (range === 'day')   d.setDate(d.getDate() - 1);
  if (range === 'week')  d.setDate(d.getDate() - 7);
  if (range === 'month') d.setMonth(d.getMonth() - 1);
  return d.toISOString();
}

async function loadStats(range) {
  const since = rangeToDate(range);
  let query = sb.from('stats').select('*').order('created_at');
  if (since) query = query.gte('created_at', since);
  const { data, error } = await query;
  if (error) { alert('Ошибка: ' + error.message); return; }
  const events = data || [];

  // Справочники (для имён)
  const [{ data: objs }, { data: cats }] = await Promise.all([
    sb.from('objections').select('id, title'),
    sb.from('categories').select('id, name'),
  ]);
  const objMap = Object.fromEntries((objs || []).map(o => [o.id, o.title]));
  const catMap = Object.fromEntries((cats || []).map(c => [c.id, c.name]));

  const clicks   = events.filter(e => e.event_type === 'objection_click');
  const catOpens = events.filter(e => e.event_type === 'category_open');
  const searches = events.filter(e => e.event_type === 'search');

  document.getElementById('kpi-clicks').textContent = clicks.length.toLocaleString('ru-RU');
  document.getElementById('kpi-searches').textContent = searches.length.toLocaleString('ru-RU');

  // Топ-10 возражений
  const topObj = aggregate(clicks, 'objection_id');
  renderTop(topObj, objMap);

  // Топ рубрик
  const topCat = aggregate(catOpens, 'category_id');
  const tbodyCat = document.querySelector('#cat-table tbody');
  tbodyCat.innerHTML = topCat.length
    ? topCat.map(([id, n]) => `<tr><td>${escapeHtml(catMap[id] || '—')}</td><td>${n}</td></tr>`).join('')
    : '<tr><td colspan="2" class="empty">Нет данных</td></tr>';

  // Топ запросов
  const qMap = {};
  for (const s of searches) {
    const q = (s.search_query || '').trim().toLowerCase();
    if (!q) continue;
    qMap[q] = (qMap[q] || 0) + 1;
  }
  const topQ = Object.entries(qMap).sort((a,b) => b[1]-a[1]).slice(0, 10);
  const tbodyQ = document.querySelector('#search-table tbody');
  tbodyQ.innerHTML = topQ.length
    ? topQ.map(([q, n]) => `<tr><td>${escapeHtml(q)}</td><td>${n}</td></tr>`).join('')
    : '<tr><td colspan="2" class="empty">Нет данных</td></tr>';

  // Динамика по дням
  renderDaysChart(clicks);
}

function aggregate(events, field) {
  const m = {};
  for (const e of events) {
    const v = e[field];
    if (!v) continue;
    m[v] = (m[v] || 0) + 1;
  }
  return Object.entries(m).sort((a,b) => b[1]-a[1]).slice(0, 10);
}

function renderTop(topObj, objMap) {
  const tbody = document.querySelector('#top-table tbody');
  tbody.innerHTML = topObj.length
    ? topObj.map(([id, n], i) => `<tr><td>${i+1}</td><td>${escapeHtml(objMap[id] || '—')}</td><td>${n}</td></tr>`).join('')
    : '<tr><td colspan="3" class="empty">Нет данных</td></tr>';

  const labels = topObj.map(([id]) => shortTitle(objMap[id] || '—'));
  const counts = topObj.map(([, n]) => n);
  if (chartTop) chartTop.destroy();
  chartTop = new Chart(document.getElementById('chart-top'), {
    type: 'bar',
    data: { labels, datasets: [{ label: 'Клики', data: counts, backgroundColor: '#2563eb' }] },
    options: {
      responsive: true,
      plugins: { legend: { display: false } },
      scales: { y: { beginAtZero: true, ticks: { precision: 0 } } },
    }
  });
}

function renderDaysChart(clicks) {
  // Группируем по дате
  const m = {};
  for (const e of clicks) {
    const d = (e.created_at || '').slice(0, 10);
    if (!d) continue;
    m[d] = (m[d] || 0) + 1;
  }
  const sorted = Object.entries(m).sort((a,b) => a[0].localeCompare(b[0]));
  const labels = sorted.map(([d]) => d.slice(5)); // MM-DD
  const data   = sorted.map(([, n]) => n);

  if (chartDays) chartDays.destroy();
  chartDays = new Chart(document.getElementById('chart-days'), {
    type: 'line',
    data: { labels, datasets: [{
      label: 'Открытий в день',
      data,
      borderColor: '#2563eb',
      backgroundColor: 'rgba(37, 99, 235, 0.1)',
      tension: 0.3,
      fill: true,
    }]},
    options: {
      responsive: true,
      plugins: { legend: { display: false } },
      scales: { y: { beginAtZero: true, ticks: { precision: 0 } } },
    }
  });
}

function shortTitle(s) { return s.length > 24 ? s.slice(0, 22) + '…' : s; }
