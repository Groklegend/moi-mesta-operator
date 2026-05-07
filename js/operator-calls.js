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
      <div class="calls-detail" id="calls-detail">—</div>
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
    document.getElementById('calls-detail').innerHTML = renderCallDetails(state.cursor, state.period);
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
        <div class="calls-stat-row">
          <span class="calls-stat-label">До 5 секунд (недозвоны)</span>
          <span class="calls-stat-val">${s.under5} <span class="calls-stat-pct">${pct(s.under5)}%</span></span>
        </div>
        <div class="calls-stat-row">
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
        <div class="calls-stat-row calls-stat-row-outcome">
          <span class="calls-stat-label">Презентация продукта</span>
          <span class="calls-stat-val">${s.presentations} <span class="calls-stat-pct">из ${s.over5} содерж.</span></span>
        </div>
        <div class="calls-stat-row calls-stat-row-outcome">
          <span class="calls-stat-label">Назначено встреч (заявок)</span>
          <span class="calls-stat-val">${s.leadsCreated} <span class="calls-stat-pct">из ${s.presentations} презент.</span></span>
        </div>
        <div class="calls-stat-row calls-stat-row-outcome">
          <span class="calls-stat-label">Конверсия в лид</span>
          <span class="calls-stat-val">${s.conversionPct}%</span>
        </div>
        <div class="calls-stat-row calls-stat-row-meta">
          <span class="calls-stat-label">Средняя длительность</span>
          <span class="calls-stat-val">${formatDuration(s.avgDuration)}</span>
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
    const presentations = sum('presentations');
    const leadsCreated = sum('leads');
    return {
      total,
      under5: sum('under5'),
      over5: over5Sum,
      over30: sum('over30'),
      min1to2: sum('min1to2'),
      over3: sum('over3'),
      presentations,
      leadsCreated,
      avgDuration: over5Sum ? Math.round(totalDuration / over5Sum) : 0,
      conversionPct: over5Sum ? Math.round(leadsCreated / over5Sum * 100) : 0,
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
    // Все сдвиги беззнаковые (>>>), иначе для seed >= 0x80000000 знаковый
    // shift даёт отрицательное число → отрицательные метрики и сломанные %.
    const total = base + (seed % 40);
    const under5Pct = 0.18 + ((seed >>> 4) % 14) / 100;
    const under5 = Math.round(total * under5Pct);
    const over5 = total - under5;
    const over30 = Math.round(over5 * (0.55 + ((seed >>> 8) % 20) / 100));
    const min1to2 = Math.round(over5 * (0.22 + ((seed >>> 11) % 14) / 100));
    const over3 = Math.round(over5 * (0.10 + ((seed >>> 14) % 14) / 100));
    const avgDuration = 35 + ((seed >>> 5) % 70); // 35–104 сек
    // Воронка: содержательные → презентации (35–55%) → встречи (15–35% от презентаций)
    const presentations = Math.round(over5 * (0.35 + ((seed >>> 17) % 21) / 100));
    const leads = Math.round(presentations * (0.15 + ((seed >>> 6) % 21) / 100));
    return { total, under5, over5, over30, min1to2, over3, presentations, avgDuration, leads };
  }

  // ---------- Разбор отдельных звонков ----------
  // Карточка под каждый успешный звонок (тот, что превратился в заявку):
  // имя ЛПР, телефон, сильные стороны оператора, % соответствия скрипту,
  // и рекомендации с объяснением «зачем» — чтобы оператор видел смысл.

  const NAMES = [
    'Иван Петров', 'Сергей Иванов', 'Анна Соколова', 'Дмитрий Ковалёв',
    'Ольга Мельник', 'Михаил Громов', 'Елена Зайцева', 'Алексей Орлов',
    'Татьяна Чернова', 'Павел Кузнецов', 'Мария Лебедева', 'Виктор Соловьёв',
  ];
  const COMPANIES = [
    'Цветочный', 'Зоотовары', 'Пекарня "У Михалыча"', 'Барбершоп Mr.Right',
    'Аптека «36,7»', 'Студия маникюра Nail&Go', 'Кофейня «Восход»',
    'Магазин рыбы «Океан»', 'Автомастерская «Гараж»', 'Книжный «Чернила»',
    'Кондитерская «Безе»', 'Мини-маркет «У дома»',
  ];
  const STRONG_POINTS = [
    'Сразу представились и назвали компанию',
    'Уточнили имя и должность ЛПР до начала презентации',
    'Спросили про текущую программу лояльности',
    'Предложили выслать материалы перед встречей',
    'Сделали комплимент бизнесу клиента',
    'Сослались на похожего клиента в той же сфере',
    'Назначили конкретную дату и время встречи',
    'Записали возражение для следующего касания',
    'Подтвердили, что звонок записывается',
    'Отзеркалили возражение клиента — он почувствовал, что услышан',
    'Использовали технику «именно поэтому» при отработке возражения',
    'Дали клиенту высказаться, не перебивали',
  ];
  const RECOMMENDATIONS = [
    {
      tip: 'Задавайте больше открытых вопросов про текущую ситуацию: «Как сейчас работаете с возвратными клиентами?»',
      why: 'Открытые вопросы вытаскивают реальные боли клиента. На встрече менеджер сразу заходит с конкретикой, а не с общими словами — конверсия встречи в сделку растёт.',
    },
    {
      tip: 'Уточняйте KPI ЛПР: «Какой средний чек вы хотите получить в этом сезоне?»',
      why: 'Когда вы знаете его метрику, на встрече вы сразу попадаете в его финансовые цели. Клиент слышит «вы про мои деньги», а не «вы про свой продукт».',
    },
    {
      tip: 'Спрашивайте про их текущие акции: «Какие активности у вас сейчас работают?»',
      why: 'Это показывает, что вы изучили клиента, и снимает позицию «продажник, который ничего не знает». ЛПР начинает воспринимать вас как партнёра, а не звонящего.',
    },
    {
      tip: 'Подбирайте кейс из той же сферы. Если барбершоп — расскажите про барбершоп, не про кафе.',
      why: 'Социальное доказательство «у конкурента сработало» снимает до 30% возражений типа «у нас в нише это не зайдёт».',
    },
    {
      tip: 'Закрывайте на конкретное время, не «когда удобно».',
      why: '«Когда удобно» = «никогда». Конкретный слот в календаре удерживает обязательство — клиент уже представляет себя на этой встрече.',
    },
    {
      tip: 'Отправляйте подтверждение в Telegram сразу после звонка.',
      why: 'Письменное подтверждение снижает no-show на встречу примерно на 40%. Клиент видит дату/время/адрес и не может «забыть».',
    },
    {
      tip: 'Не торопитесь с презентацией продукта в первом звонке.',
      why: 'Цель первого звонка — назначить встречу, а не продать. Ранняя презентация даёт клиенту повод «подумать» и сорвать встречу.',
    },
    {
      tip: 'Записывайте дословно фразы клиента и передавайте их менеджеру.',
      why: 'Когда менеджер на встрече использует слова клиента — клиент чувствует, что его услышали. Доверие растёт быстрее, чем за час обычной беседы.',
    },
    {
      tip: 'Спрашивайте «Что для вас в этом важно?» вместо «Вам это интересно?»',
      why: 'Закрытый вопрос даёт клиенту лёгкий выход «не интересно». Открытый — заставляет осмыслить, почему он вообще говорит с вами.',
    },
    {
      tip: 'Отрабатывайте возражение «дорого» вопросом «По сравнению с чем?»',
      why: 'Это переводит разговор из эмоций в цифры. Клиент часто сам понимает, что не сравнивал — и возражение растворяется.',
    },
  ];

  function generateDayCalls(day) {
    const stats = fetchCallStats(day);
    const calls = [];
    for (let i = 0; i < stats.leads; i++) {
      const seed = hashStr(formatYmd(day) + ':' + i);
      const baseDur = 60 + ((seed >>> 2) % 240);
      calls.push({
        contactName: NAMES[seed % NAMES.length],
        companyName: COMPANIES[(seed >>> 4) % COMPANIES.length],
        phone:       generatePhone(seed),
        durationSec: baseDur,
        strongPoints:    pickN(STRONG_POINTS, 3, seed),
        adherencePct:    65 + ((seed >>> 7) % 31),
        recommendations: pickN(RECOMMENDATIONS, 2, seed >>> 11),
      });
    }
    return calls;
  }

  function renderCallDetails(cursor, period) {
    const calls = generateDayCalls(cursor);
    const dayLabel = formatDay(cursor);
    const periodNote = period !== 'day'
      ? `<div class="calls-detail-note">Разбор показывается за один день. Стрелки ‹/› листают по выбранному периоду — для перехода по дням переключите режим в «День».</div>`
      : '';
    if (!calls.length) {
      return `
        <div class="calls-detail-head">
          <h3>Разбор звонков за ${escapeHtml(dayLabel)}</h3>
        </div>
        ${periodNote}
        <div class="calls-detail-empty">За этот день успешных звонков нет.</div>
      `;
    }
    return `
      <div class="calls-detail-head">
        <h3>Разбор звонков за ${escapeHtml(dayLabel)}</h3>
        <span class="calls-detail-count">${calls.length} ${plural(calls.length, 'звонков', 'звонок', 'звонка')}</span>
      </div>
      ${periodNote}
      <div class="calls-detail-list">
        ${calls.map(renderCallCard).join('')}
      </div>
    `;
  }

  function renderCallCard(c) {
    const phoneHref = c.phone.replace(/[^\d+]/g, '');
    const adherenceTone = c.adherencePct >= 85 ? 'good' : c.adherencePct >= 70 ? 'mid' : 'low';
    return `
      <div class="call-card">
        <div class="call-card-head">
          <div class="call-card-name">
            <strong>${escapeHtml(c.contactName)}</strong>
            <span class="call-card-company">· ${escapeHtml(c.companyName)}</span>
          </div>
          <a class="call-card-phone" href="tel:${escapeHtml(phoneHref)}">${escapeHtml(c.phone)}</a>
        </div>
        <div class="call-card-meta">Длительность: ${formatDuration(c.durationSec)}</div>

        <div class="call-card-section">
          <div class="call-card-section-title">✅ Сильные стороны, которые вы использовали</div>
          <ul class="call-card-list">
            ${c.strongPoints.map((p) => `<li>${escapeHtml(p)}</li>`).join('')}
          </ul>
        </div>

        <div class="call-card-adherence call-card-adherence-${adherenceTone}">
          <div class="call-card-adherence-label">
            Соответствие скрипту: <b>${c.adherencePct}%</b>
          </div>
          <div class="call-card-adherence-bar">
            <div class="call-card-adherence-fill" style="width:${c.adherencePct}%"></div>
          </div>
        </div>

        <div class="call-card-section">
          <div class="call-card-section-title">💡 Что добавить — и зачем это нужно</div>
          <ul class="call-card-list call-card-list-recos">
            ${c.recommendations.map((r) => `
              <li>
                <div class="call-card-tip">${escapeHtml(r.tip)}</div>
                <div class="call-card-why"><b>Зачем:</b> ${escapeHtml(r.why)}</div>
              </li>
            `).join('')}
          </ul>
        </div>
      </div>
    `;
  }

  function generatePhone(seed) {
    const code3 = ['903', '905', '910', '915', '916', '925', '926', '929'];
    const a = code3[seed % code3.length];
    const b = 100 + ((seed >>> 4) % 900);
    const c = 10 + ((seed >>> 8) % 90);
    const d = 10 + ((seed >>> 12) % 90);
    return `+7 (${a}) ${b}-${String(c).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
  }

  // Стабильный «случайный» выбор N элементов из пула по seed.
  function pickN(pool, n, seed) {
    const arr = pool.slice();
    const out = [];
    let s = (seed >>> 0) || 1;
    for (let i = 0; i < n && arr.length; i++) {
      s = (s * 16807 + 12345) >>> 0;
      const idx = s % arr.length;
      out.push(arr[idx]);
      arr.splice(idx, 1);
    }
    return out;
  }

  function escapeHtml(s) {
    return String(s ?? '').replace(/[&<>"']/g, (c) => ({
      '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;',
    }[c]));
  }

  function formatYmd(d) {
    return `${d.getFullYear()}-${d.getMonth()+1}-${d.getDate()}`;
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
