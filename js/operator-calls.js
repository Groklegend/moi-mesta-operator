// Раздел «Анализ звонков» в кабинете оператора. Триггерится отдельной
// кнопкой в шапке (op-calls-tab-btn). UI: слева статистика, справа —
// рекомендации. Стрелки ‹/› листают окно, табы День/Неделя/Месяц
// меняют ширину окна.
//
// Источник данных — fetchCallStats(operatorId, fromIso, toIso). Сейчас
// внутри функции — детерминированный мок (стабильные числа по дате),
// потому что в БД звонков нет. Когда подключим телефонию (Tolfin) —
// заменяем тело fetchCallStats на реальный запрос; UI остаётся как есть.

(function () {
  'use strict';

  const PERIODS = { day: 'День', week: 'Неделя', month: 'Месяц' };

  const state = {
    period: 'day',
    cursor: startOfDay(new Date()),
    inited: false,
  };

  // ---------- Жизненный цикл ----------
  function show() {
    const pane = document.getElementById('calls-pane');
    if (!pane) return;
    if (!state.inited) {
      pane.innerHTML = scaffold();
      bindControls(pane);
      state.inited = true;
    }
    render();
  }

  // ---------- Разметка ----------
  function scaffold() {
    return `
      <div class="calls-toolbar">
        <div class="calls-nav">
          <button class="calls-nav-btn" data-calls-action="prev" type="button" aria-label="Раньше">‹</button>
          <div class="calls-range" id="calls-range">—</div>
          <button class="calls-nav-btn" data-calls-action="next" type="button" aria-label="Позже">›</button>
        </div>
        <div class="calls-period-tabs" role="tablist">
          ${Object.entries(PERIODS).map(([k, v]) => `
            <button class="calls-period-tab" data-calls-action="period-${k}" data-period="${k}" type="button">${v}</button>
          `).join('')}
        </div>
      </div>
      <div class="calls-demo-banner">
        📊 Демо-данные. После подключения телефонии (Tolfin) тут появятся реальные звонки оператора.
      </div>
      <div class="calls-grid">
        <div class="calls-stats-card" id="calls-stats">—</div>
        <div class="calls-recos-card" id="calls-recos">—</div>
      </div>
    `;
  }

  function bindControls(pane) {
    pane.addEventListener('click', (e) => {
      const t = e.target.closest('[data-calls-action]');
      if (!t) return;
      const a = t.dataset.callsAction;
      if (a === 'prev') step(-1);
      else if (a === 'next') step(+1);
      else if (a.startsWith('period-')) setPeriod(a.slice('period-'.length));
    });
  }

  function step(dir) {
    const d = new Date(state.cursor);
    if (state.period === 'day') d.setDate(d.getDate() + dir);
    else if (state.period === 'week') d.setDate(d.getDate() + 7 * dir);
    else if (state.period === 'month') d.setMonth(d.getMonth() + dir);
    // не уходим в будущее дальше сегодняшнего дня
    const today = startOfDay(new Date());
    if (d > today) return;
    state.cursor = startOfDay(d);
    render();
  }

  function setPeriod(p) {
    if (!PERIODS[p]) return;
    state.period = p;
    render();
  }

  // ---------- Рендер ----------
  function render() {
    const pane = document.getElementById('calls-pane');
    if (!pane || pane.hidden) return;

    // активная вкладка периода
    pane.querySelectorAll('.calls-period-tab').forEach((b) => {
      b.classList.toggle('active', b.dataset.period === state.period);
    });

    const { from, to } = rangeOf(state.cursor, state.period);
    document.getElementById('calls-range').textContent = formatRange(from, to, state.period);

    const stats = aggregateRange(from, to);
    document.getElementById('calls-stats').innerHTML = renderStats(stats, state.period);
    document.getElementById('calls-recos').innerHTML = renderRecos(stats);
  }

  function renderStats(s, period) {
    const periodLabel = period === 'day' ? 'за день' : period === 'week' ? 'за неделю' : 'за месяц';
    const pct = (n) => s.total ? Math.round(n / s.total * 100) : 0;
    return `
      <div class="calls-stats-head">
        <span class="calls-stats-title">Статистика ${periodLabel}</span>
        <span class="calls-stats-total">${s.total} <span class="calls-stats-unit">звонк${plural(s.total, 'ов', '', 'а')}</span></span>
      </div>
      <div class="calls-stats-list">
        <div class="calls-stat-row calls-stat-row-bad">
          <span class="calls-stat-label">До 5 секунд (недозвоны)</span>
          <span class="calls-stat-val">${s.under5} <span class="calls-stat-pct">${pct(s.under5)}%</span></span>
        </div>
        <div class="calls-stat-row calls-stat-row-good">
          <span class="calls-stat-label">От 5 секунд (содержательные)</span>
          <span class="calls-stat-val">${s.over5} <span class="calls-stat-pct">${pct(s.over5)}%</span></span>
        </div>
        <div class="calls-stat-divider"></div>
        <div class="calls-stat-row">
          <span class="calls-stat-label">Свыше 30 секунд</span>
          <span class="calls-stat-val">${s.over30} <span class="calls-stat-pct">${pct(s.over30)}%</span></span>
        </div>
        <div class="calls-stat-row">
          <span class="calls-stat-label">От 1 до 2 минут</span>
          <span class="calls-stat-val">${s.min1to2} <span class="calls-stat-pct">${pct(s.min1to2)}%</span></span>
        </div>
        <div class="calls-stat-row">
          <span class="calls-stat-label">Больше 3 минут</span>
          <span class="calls-stat-val">${s.over3} <span class="calls-stat-pct">${pct(s.over3)}%</span></span>
        </div>
        <div class="calls-stat-divider"></div>
        <div class="calls-stat-row calls-stat-row-meta">
          <span class="calls-stat-label">Средняя длительность</span>
          <span class="calls-stat-val">${formatDuration(s.avgDuration)}</span>
        </div>
        <div class="calls-stat-row calls-stat-row-meta">
          <span class="calls-stat-label">Конверсия в лид</span>
          <span class="calls-stat-val">${s.conversionPct}%</span>
        </div>
      </div>
    `;
  }

  function renderRecos(s) {
    const good = [];
    const bad = [];

    const undeliv = s.total ? s.under5 / s.total : 0;
    const meaningful = s.total ? s.over5 / s.total : 0;
    const long = s.over5 ? s.over3 / s.over5 : 0;
    const mid = s.over5 ? s.min1to2 / s.over5 : 0;

    if (undeliv > 0.3) bad.push(`Слишком много недозвонов — <b>${Math.round(undeliv * 100)}%</b>. Проверьте качество базы и время дозвона.`);
    else if (undeliv < 0.2) good.push(`Низкая доля недозвонов — <b>${Math.round(undeliv * 100)}%</b>. База чистая, время выбрано удачно.`);

    if (meaningful > 0.7) good.push(`Большинство звонков — содержательные (>5 сек): <b>${Math.round(meaningful * 100)}%</b>.`);

    if (long > 0.18) good.push(`Много длинных разговоров (>3 мин) — <b>${Math.round(long * 100)}%</b> от содержательных. Оператор глубоко вовлекает ЛПР.`);
    else if (long < 0.08 && s.over5 > 30) bad.push(`Мало длинных разговоров — всего <b>${Math.round(long * 100)}%</b> от содержательных. Возможно, скрипт обрывается слишком рано.`);

    if (mid > 0.25) good.push(`Хорошая «средняя» зона 1–2 мин — <b>${Math.round(mid * 100)}%</b>. Оператор стабильно доводит до сути.`);

    if (s.conversionPct >= 12) good.push(`Конверсия в лид <b>${s.conversionPct}%</b> — выше среднего по команде.`);
    else if (s.conversionPct < 6 && s.total > 50) bad.push(`Конверсия в лид <b>${s.conversionPct}%</b> низкая. Стоит послушать длинные звонки и сверить с эталоном.`);

    if (s.avgDuration < 25 && s.total > 30) bad.push(`Средняя длительность <b>${formatDuration(s.avgDuration)}</b> низкая — большинство контактов короткие. Поработайте над зацепкой первых 10 секунд.`);
    if (s.avgDuration > 75) good.push(`Средняя длительность <b>${formatDuration(s.avgDuration)}</b> — оператор удерживает внимание ЛПР.`);

    if (!good.length) good.push('Нейтральный день — выраженных сильных сторон не выявлено.');
    if (!bad.length) bad.push('Критичных проблем не видно. Так держать.');

    return `
      <div class="calls-recos-block calls-recos-good">
        <div class="calls-recos-title">✅ Что хорошо</div>
        <ul class="calls-recos-list">
          ${good.map((t) => `<li>${t}</li>`).join('')}
        </ul>
      </div>
      <div class="calls-recos-block calls-recos-bad">
        <div class="calls-recos-title">⚠️ Что улучшить</div>
        <ul class="calls-recos-list">
          ${bad.map((t) => `<li>${t}</li>`).join('')}
        </ul>
      </div>
    `;
  }

  // ---------- Агрегация ----------
  // Перебираем дни внутри окна, берём метрики каждого дня и складываем.
  function aggregateRange(from, to) {
    const days = [];
    for (let d = new Date(from); d < to; d.setDate(d.getDate() + 1)) {
      days.push(fetchCallStats(new Date(d)));
    }
    const sum = (k) => days.reduce((a, x) => a + x[k], 0);
    const total = sum('total');
    const totalDuration = days.reduce((a, x) => a + x.avgDuration * x.over5, 0);
    const over5Sum = sum('over5');
    return {
      total,
      under5: sum('under5'),
      over5: over5Sum,
      over30: sum('over30'),
      min1to2: sum('min1to2'),
      over3: sum('over3'),
      avgDuration: over5Sum ? Math.round(totalDuration / over5Sum) : 0,
      conversionPct: total ? Math.round(sum('leads') / over5Sum * 100) : 0,
    };
  }

  // ---------- ИСТОЧНИК ДАННЫХ ----------
  // Сейчас — детерминированный мок: фиксируем seed по дате, чтобы один и
  // тот же день всегда показывал одну и ту же картинку. Когда подключим
  // телефонию — заменяем эту функцию на запрос в БД/Tolfin API за тот
  // же интервал [day, day+1).
  function fetchCallStats(day) {
    const ymd = `${day.getFullYear()}-${day.getMonth()+1}-${day.getDate()}`;
    const seed = hashStr(ymd);
    // Будни (пн-пт) — больше звонков, выходные — меньше
    const dow = day.getDay(); // 0=вс
    const weekend = dow === 0 || dow === 6;
    const base = weekend ? 25 : 95;
    const total = base + (seed % 40);
    const under5Pct = 0.18 + ((seed >> 4) % 14) / 100;
    const under5 = Math.round(total * under5Pct);
    const over5 = total - under5;
    const over30 = Math.round(over5 * (0.55 + ((seed >> 8) % 20) / 100));
    const min1to2 = Math.round(over5 * (0.22 + ((seed >> 11) % 14) / 100));
    const over3 = Math.round(over5 * (0.10 + ((seed >> 14) % 14) / 100));
    const avgDuration = 35 + ((seed >> 5) % 70); // 35–104 сек
    const leads = Math.round(over5 * (0.06 + ((seed >> 6) % 12) / 100));
    return { total, under5, over5, over30, min1to2, over3, avgDuration, leads };
  }

  // ---------- Утилиты ----------
  function startOfDay(d) { const x = new Date(d); x.setHours(0,0,0,0); return x; }

  function rangeOf(cursor, period) {
    const start = startOfDay(cursor);
    const end = new Date(start);
    if (period === 'day') {
      end.setDate(end.getDate() + 1);
    } else if (period === 'week') {
      // окно = 7 дней, заканчивая cursor включительно
      start.setDate(start.getDate() - 6);
      end.setDate(cursor.getDate() + 1);
    } else if (period === 'month') {
      // окно = 30 дней, заканчивая cursor включительно
      start.setDate(start.getDate() - 29);
      end.setDate(cursor.getDate() + 1);
    }
    return { from: start, to: end };
  }

  const WEEKDAYS = ['вс','пн','вт','ср','чт','пт','сб'];
  const MONTHS_GEN = ['января','февраля','марта','апреля','мая','июня','июля','августа','сентября','октября','ноября','декабря'];
  function formatDay(d) { return `${WEEKDAYS[d.getDay()]} ${d.getDate()} ${MONTHS_GEN[d.getMonth()]}`; }
  function formatRange(from, to, period) {
    if (period === 'day') return formatDay(from);
    const last = new Date(to); last.setDate(last.getDate() - 1);
    return `${formatDay(from)} — ${formatDay(last)}`;
  }
  function formatDuration(sec) {
    if (!sec) return '—';
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return m ? `${m} мин ${s} сек` : `${s} сек`;
  }
  function plural(n, many, one, few) {
    const m10 = n % 10, m100 = n % 100;
    if (m10 === 1 && m100 !== 11) return one;
    if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
    return many;
  }
  function hashStr(s) {
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = (h * 16777619) >>> 0;
    }
    return h;
  }

  window.operatorCalls = { show };
})();
