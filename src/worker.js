// ============================================================
// Cloudflare Worker для Хаба «Мои Места»
// ============================================================
// Маршрутизирует /api/v1/* в API-обработчики; всё остальное отдаёт
// статикой через ASSETS-биндинг (привычное поведение Workers Assets).
//
// Авторизация:
//   • Админские эндпоинты (/api/v1/admin/*) — JWT администратора
//     из Supabase Auth (Bearer access_token из sb.auth.getSession()).
//     Worker верифицирует токен через Supabase /auth/v1/user и проверяет,
//     что у пользователя есть роль 'admin' в public.users (status='active').
//   • Гари-эндпоинты (/api/v1/*, не /admin) появятся в этап-3 — будут
//     проверять Bearer service_token через таблицу service_tokens.
//
// Секреты (wrangler secret put):
//   • SUPABASE_SERVICE_ROLE — service_role JWT, для админских действий.
// Vars (wrangler.jsonc):
//   • SUPABASE_URL — URL проекта Supabase.

const json = (body, init = {}) =>
  new Response(JSON.stringify(body), {
    status: init.status || 200,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      ...(init.headers || {}),
    },
  });

const cors = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, POST, PATCH, DELETE, OPTIONS',
  'access-control-allow-headers': 'authorization, content-type',
};

function withCors(resp) {
  for (const [k, v] of Object.entries(cors)) resp.headers.set(k, v);
  return resp;
}

// ---------- Helpers ----------

async function supaFetch(env, path, init = {}) {
  return fetch(`${env.SUPABASE_URL}${path}`, {
    ...init,
    headers: {
      apikey: env.SUPABASE_SERVICE_ROLE,
      authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE}`,
      'content-type': 'application/json',
      ...(init.headers || {}),
    },
  });
}

async function getUserFromJwt(env, jwt) {
  const r = await fetch(`${env.SUPABASE_URL}/auth/v1/user`, {
    headers: {
      authorization: `Bearer ${jwt}`,
      apikey: env.SUPABASE_SERVICE_ROLE,
    },
  });
  if (!r.ok) return null;
  return r.json();
}

async function getRoleRow(env, userId) {
  const r = await supaFetch(env, `/rest/v1/users?select=roles,status,email&id=eq.${userId}`);
  if (!r.ok) return null;
  const rows = await r.json();
  return rows[0] || null;
}

async function requireAdmin(request, env) {
  const auth = request.headers.get('authorization') || '';
  const m = auth.match(/^Bearer\s+(.+)$/i);
  if (!m) return { error: json({ error: 'no_token' }, { status: 401 }) };
  const user = await getUserFromJwt(env, m[1]);
  if (!user || !user.id) return { error: json({ error: 'invalid_token' }, { status: 401 }) };
  const row = await getRoleRow(env, user.id);
  if (!row || row.status !== 'active' || !(row.roles || []).includes('admin')) {
    return { error: json({ error: 'not_admin' }, { status: 403 }) };
  }
  return { user, row };
}

async function sha256Hex(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}

// Авторизация Гари по сервисному токену (ТЗ §6.1 основного ТЗ Хаба).
// Bearer-токен сравниваем как sha256-хеш с public.service_tokens.token_hash.
async function requireServiceToken(request, env) {
  const auth = request.headers.get('authorization') || '';
  const m = auth.match(/^Bearer\s+(.+)$/i);
  if (!m) return { error: json({ error: 'no_token' }, { status: 401 }) };
  const hash = await sha256Hex(m[1]);
  const r = await supaFetch(env, `/rest/v1/service_tokens?select=id,name,revoked_at&token_hash=eq.${hash}`);
  if (!r.ok) return { error: json({ error: 'token_lookup_failed' }, { status: 500 }) };
  const rows = await r.json();
  const tok = rows[0];
  if (!tok || tok.revoked_at) return { error: json({ error: 'invalid_token' }, { status: 401 }) };
  // Обновим last_used_at "огнём и забыли" — не блокируем ответ.
  supaFetch(env, `/rest/v1/service_tokens?id=eq.${tok.id}`, {
    method: 'PATCH',
    headers: { prefer: 'return=minimal' },
    body: JSON.stringify({ last_used_at: new Date().toISOString() }),
  }).catch(() => {});
  return { token: tok };
}

async function writeAudit(env, request, payload) {
  const ip =
    request.headers.get('cf-connecting-ip') ||
    request.headers.get('x-forwarded-for') ||
    null;
  const ua = request.headers.get('user-agent') || null;
  await supaFetch(env, '/rest/v1/audit_log', {
    method: 'POST',
    headers: { prefer: 'return=minimal' },
    body: JSON.stringify({ ...payload, ip_address: ip, user_agent: ua }),
  });
}

// ---------- /api/v1/admin/invite ----------

async function inviteUser(request, env) {
  const guard = await requireAdmin(request, env);
  if (guard.error) return guard.error;

  let body;
  try { body = await request.json(); } catch { return json({ error: 'bad_json' }, { status: 400 }); }
  const email = (body?.email || '').trim();
  const full_name = (body?.full_name || '').trim();
  const roles = Array.isArray(body?.roles) ? body.roles : [];
  if (!email || roles.length === 0) {
    return json({ error: 'email_and_roles_required' }, { status: 400 });
  }

  const origin = new URL(request.url).origin;
  const r = await supaFetch(env, '/auth/v1/invite', {
    method: 'POST',
    body: JSON.stringify({
      email,
      data: { full_name, roles: roles.join(',') },
      redirect_to: `${origin}/invite`,
    }),
  });
  if (!r.ok) {
    const detail = await r.text();
    return json({ error: 'invite_failed', detail }, { status: r.status });
  }
  const created = await r.json();

  // Триггер on_auth_user_created создаёт строку в public.users, но roles
  // он раскладывает только если raw_user_meta_data.roles был csv. На всякий
  // случай дополним полями явно (идемпотентно).
  if (created?.id) {
    await supaFetch(env, `/rest/v1/users?id=eq.${created.id}`, {
      method: 'PATCH',
      headers: { prefer: 'return=minimal' },
      body: JSON.stringify({ full_name, roles, status: 'active' }),
    });
  }

  await writeAudit(env, request, {
    user_id: guard.user.id,
    user_email: guard.user.email,
    action: 'user_invite',
    target_type: 'user',
    target_id: created?.id || null,
    metadata: { email, roles, full_name },
  });

  return json({ ok: true, id: created?.id || null, email });
}

// ---------- /api/v1/admin/users/:id/email ----------

async function changeEmail(request, env, userId) {
  const guard = await requireAdmin(request, env);
  if (guard.error) return guard.error;

  let body;
  try { body = await request.json(); } catch { return json({ error: 'bad_json' }, { status: 400 }); }
  const email = (body?.email || '').trim();
  if (!email) return json({ error: 'email_required' }, { status: 400 });

  const r1 = await supaFetch(env, `/auth/v1/admin/users/${userId}`, {
    method: 'PUT',
    body: JSON.stringify({ email, email_confirm: true }),
  });
  if (!r1.ok) {
    const detail = await r1.text();
    return json({ error: 'auth_update_failed', detail }, { status: r1.status });
  }

  await supaFetch(env, `/rest/v1/users?id=eq.${userId}`, {
    method: 'PATCH',
    headers: { prefer: 'return=minimal' },
    body: JSON.stringify({ email }),
  });

  await writeAudit(env, request, {
    user_id: guard.user.id,
    user_email: guard.user.email,
    action: 'user_email_change',
    target_type: 'user',
    target_id: userId,
    metadata: { new_email: email },
  });

  return json({ ok: true });
}

// ---------- /api/v1/reports/sellers (Гари) ----------

const SELLER_REPORT_FIELDS = [
  'meetings_scheduled', 'meetings_held', 'agreed_to_test', 'refused',
  'thinking', 'integration_needed', 'launched_on_test', 'signed_and_paid',
];

async function listSellerReports(request, env) {
  const guard = await requireServiceToken(request, env);
  if (guard.error) return guard.error;
  const url = new URL(request.url);
  const from = url.searchParams.get('from');
  const to = url.searchParams.get('to');
  const sellerId = url.searchParams.get('seller_id');
  const params = new URLSearchParams({ select: '*', order: 'report_date.desc' });
  if (from) params.append('report_date', `gte.${from}`);
  if (to) params.append('report_date', `lte.${to}`);
  if (sellerId) params.append('seller_id', `eq.${sellerId}`);
  const r = await supaFetch(env, `/rest/v1/seller_daily_reports?${params}`);
  if (!r.ok) {
    const detail = await r.text();
    return json({ error: 'fetch_failed', detail }, { status: r.status });
  }
  return json(await r.json());
}

async function getSellerReport(request, env, sellerId, date) {
  const guard = await requireServiceToken(request, env);
  if (guard.error) return guard.error;
  const r = await supaFetch(env, `/rest/v1/seller_daily_reports?select=*&seller_id=eq.${sellerId}&report_date=eq.${date}`);
  if (!r.ok) return json({ error: 'fetch_failed' }, { status: r.status });
  const rows = await r.json();
  if (!rows.length) return json({ error: 'not_found' }, { status: 404 });
  return json(rows[0]);
}

function isoWeekKey(dateStr) {
  // ISO week: YYYY-Www. Понедельник — первый день недели.
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  const dayOfWeek = (dt.getUTCDay() + 6) % 7; // Mon=0..Sun=6
  dt.setUTCDate(dt.getUTCDate() - dayOfWeek + 3); // ближайший четверг
  const firstThursday = dt.valueOf();
  const yearStart = new Date(Date.UTC(dt.getUTCFullYear(), 0, 1));
  const week = 1 + Math.round(((firstThursday - yearStart.valueOf()) / 86400000 - 3 + ((yearStart.getUTCDay() + 6) % 7)) / 7);
  return `${dt.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

async function aggregateSellerReports(request, env) {
  const guard = await requireServiceToken(request, env);
  if (guard.error) return guard.error;
  const url = new URL(request.url);
  const from = url.searchParams.get('from');
  const to = url.searchParams.get('to');
  const sellerId = url.searchParams.get('seller_id');
  const group = url.searchParams.get('group') || 'day';
  if (!['day', 'week', 'month'].includes(group)) {
    return json({ error: 'bad_group', allowed: ['day', 'week', 'month'] }, { status: 400 });
  }

  const params = new URLSearchParams({ select: '*' });
  if (from) params.append('report_date', `gte.${from}`);
  if (to) params.append('report_date', `lte.${to}`);
  if (sellerId) params.append('seller_id', `eq.${sellerId}`);
  const r = await supaFetch(env, `/rest/v1/seller_daily_reports?${params}`);
  if (!r.ok) return json({ error: 'fetch_failed' }, { status: r.status });
  const rows = await r.json();

  const buckets = new Map();
  for (const row of rows) {
    let key;
    if (group === 'month') key = String(row.report_date).slice(0, 7);
    else if (group === 'week') key = isoWeekKey(row.report_date);
    else key = row.report_date;
    if (!buckets.has(key)) {
      const init = { period: key };
      for (const f of SELLER_REPORT_FIELDS) init[f] = 0;
      buckets.set(key, init);
    }
    const b = buckets.get(key);
    for (const f of SELLER_REPORT_FIELDS) b[f] += row[f] || 0;
  }
  const data = [...buckets.values()].sort((a, b) => a.period < b.period ? -1 : 1);
  return json({ group, count: data.length, data });
}

// ---------- /api/v1/dadata/* (прокси для формы подключения компании) ----------
//
// Ключ DaData в env.DADATA_TOKEN (Cloudflare Worker secret). Бесплатный план
// до 10 000 запросов в день. Если ключ не задан — отдаём 503, чтобы UI
// мог показать понятную ошибку без падения формы.

async function dadataProxy(request, env, kind) {
  if (!env.DADATA_TOKEN) {
    return json({ error: 'dadata_not_configured' }, { status: 503 });
  }
  const url = new URL(request.url);
  let body;
  if (kind === 'party') {
    const inn = (url.searchParams.get('inn') || '').replace(/\D/g, '');
    if (!(inn.length === 10 || inn.length === 12)) {
      return json({ error: 'bad_inn' }, { status: 400 });
    }
    body = { query: inn };
    return await dadataFetch(env, 'rs/findById/party', body);
  }
  if (kind === 'address') {
    const q = (url.searchParams.get('q') || '').trim();
    if (q.length < 3) return json({ suggestions: [] });
    body = { query: q, count: 7 };
    return await dadataFetch(env, 'rs/suggest/address', body);
  }
  if (kind === 'bank') {
    const bik = (url.searchParams.get('bik') || '').replace(/\D/g, '');
    if (bik.length !== 9) {
      return json({ error: 'bad_bik' }, { status: 400 });
    }
    body = { query: bik };
    return await dadataFetch(env, 'rs/findById/bank', body);
  }
  return json({ error: 'unknown_kind' }, { status: 400 });
}

async function dadataFetch(env, path, body) {
  const r = await fetch(`https://suggestions.dadata.ru/suggestions/api/4_1/${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json',
      authorization: `Token ${env.DADATA_TOKEN}`,
    },
    body: JSON.stringify(body),
  });
  if (!r.ok) {
    const detail = await r.text();
    return json({ error: 'dadata_error', detail }, { status: r.status });
  }
  return json(await r.json());
}

// ---------- /api/v1/applications/* (Гари — service token) ----------

async function listApplications(request, env) {
  const guard = await requireServiceToken(request, env);
  if (guard.error) return guard.error;
  const url = new URL(request.url);
  const status = url.searchParams.get('status');
  const sellerId = url.searchParams.get('seller_id');
  const from = url.searchParams.get('from');
  const to = url.searchParams.get('to');
  const params = new URLSearchParams({ select: '*', order: 'created_at.desc' });
  if (status) params.append('status', `eq.${status}`);
  if (sellerId) params.append('seller_id', `eq.${sellerId}`);
  if (from) params.append('created_at', `gte.${from}`);
  if (to) params.append('created_at', `lte.${to}`);
  const r = await supaFetch(env, `/rest/v1/applications?${params}`);
  if (!r.ok) {
    const detail = await r.text();
    return json({ error: 'fetch_failed', detail }, { status: r.status });
  }
  return json(await r.json());
}

async function getApplication(request, env, id) {
  const guard = await requireServiceToken(request, env);
  if (guard.error) return guard.error;
  const r = await supaFetch(env, `/rest/v1/applications?select=*&id=eq.${id}`);
  if (!r.ok) return json({ error: 'fetch_failed' }, { status: r.status });
  const rows = await r.json();
  if (!rows.length) return json({ error: 'not_found' }, { status: 404 });
  return json(rows[0]);
}

async function patchApplicationStatus(request, env, id) {
  const guard = await requireServiceToken(request, env);
  if (guard.error) return guard.error;
  let body;
  try { body = await request.json(); } catch { return json({ error: 'bad_json' }, { status: 400 }); }
  const status = body?.status;
  const allowed = ['draft','new','in_progress','images_pending','text_pending','creating_cabinet','ready','launched'];
  if (!allowed.includes(status)) return json({ error: 'bad_status', allowed }, { status: 400 });
  const r = await supaFetch(env, `/rest/v1/applications?id=eq.${id}`, {
    method: 'PATCH',
    headers: { prefer: 'return=representation' },
    body: JSON.stringify({ status }),
  });
  if (!r.ok) return json({ error: 'update_failed' }, { status: r.status });
  const rows = await r.json();
  const app = rows[0];
  if (!app) return json({ error: 'not_found' }, { status: 404 });
  await writeAudit(env, request, {
    is_agent: true,
    action: 'application_status_change',
    target_type: 'application',
    target_id: id,
    metadata: { status },
  });
  // Системное уведомление менеджеру.
  await supaFetch(env, '/rest/v1/notifications', {
    method: 'POST',
    headers: { prefer: 'return=minimal' },
    body: JSON.stringify({
      user_id: app.seller_id,
      title: 'Статус заявки изменён',
      body: `«${app.company_name || '—'}» → ${status}`,
      link: `seller.html#deals`,
    }),
  });
  return json(app);
}

async function postApplicationMessage(request, env, id) {
  const guard = await requireServiceToken(request, env);
  if (guard.error) return guard.error;
  let body;
  try { body = await request.json(); } catch { return json({ error: 'bad_json' }, { status: 400 }); }
  const text = (body?.body || '').trim();
  if (!text) return json({ error: 'body_required' }, { status: 400 });
  // Получаем seller_id заявки.
  const ar = await supaFetch(env, `/rest/v1/applications?select=seller_id,company_name&id=eq.${id}`);
  const arows = ar.ok ? await ar.json() : [];
  if (!arows.length) return json({ error: 'application_not_found' }, { status: 404 });
  const app = arows[0];
  const r = await supaFetch(env, '/rest/v1/application_messages', {
    method: 'POST',
    headers: { prefer: 'return=representation' },
    body: JSON.stringify({ application_id: id, author: 'gary', body: text }),
  });
  if (!r.ok) {
    const detail = await r.text();
    return json({ error: 'insert_failed', detail }, { status: r.status });
  }
  // Уведомление менеджеру.
  await supaFetch(env, '/rest/v1/notifications', {
    method: 'POST',
    headers: { prefer: 'return=minimal' },
    body: JSON.stringify({
      user_id: app.seller_id,
      title: 'Гари: новое сообщение',
      body: text.length > 140 ? text.slice(0, 140) + '…' : text,
      link: `seller.html#deals`,
    }),
  });
  return json((await r.json())[0]);
}

// ---------- POST /api/v1/applications/:id/submit (менеджер нажал «Передать Гари») ----------
//
// Авторизация — JWT менеджера (он же владелец заявки). Проверяем владение,
// меняем статус draft → new через service_role, отправляем webhook на
// env.GARY_WEBHOOK_URL (до 3 попыток с интервалом 30 сек, попытки 2-3
// уходят в ctx.waitUntil чтобы не держать UI).

async function submitApplication(request, env, ctx, id) {
  const auth = request.headers.get('authorization') || '';
  const m = auth.match(/^Bearer\s+(.+)$/i);
  if (!m) return json({ error: 'no_token' }, { status: 401 });
  const user = await getUserFromJwt(env, m[1]);
  if (!user || !user.id) return json({ error: 'invalid_token' }, { status: 401 });

  // Проверяем, что заявка принадлежит этому менеджеру.
  const ar = await supaFetch(env, `/rest/v1/applications?select=*&id=eq.${id}`);
  if (!ar.ok) return json({ error: 'fetch_failed' }, { status: ar.status });
  const arows = await ar.json();
  if (!arows.length) return json({ error: 'not_found' }, { status: 404 });
  const app = arows[0];
  if (app.seller_id !== user.id) return json({ error: 'forbidden' }, { status: 403 });

  // Минимальная серверная валидация: company_name + lpr_phone + хотя бы 1 филиал + loyalty.type
  if (!app.company_name || !app.inn || !app.lpr_name || !app.lpr_phone) {
    return json({ error: 'incomplete', detail: 'Не заполнены обязательные поля' }, { status: 400 });
  }
  if (!Array.isArray(app.branches) || app.branches.length === 0) {
    return json({ error: 'no_branches' }, { status: 400 });
  }
  if (!app.loyalty || !app.loyalty.type) {
    return json({ error: 'no_loyalty' }, { status: 400 });
  }

  // Меняем статус на 'new' и проставляем submitted_at.
  const upd = await supaFetch(env, `/rest/v1/applications?id=eq.${id}`, {
    method: 'PATCH',
    headers: { prefer: 'return=representation' },
    body: JSON.stringify({ status: 'new', submitted_at: new Date().toISOString() }),
  });
  if (!upd.ok) {
    const detail = await upd.text();
    return json({ error: 'update_failed', detail }, { status: upd.status });
  }
  const fresh = (await upd.json())[0] || app;

  // Аудит.
  await writeAudit(env, request, {
    user_id: user.id,
    user_email: user.email,
    action: 'application_submit',
    target_type: 'application',
    target_id: id,
    metadata: { company_name: fresh.company_name },
  });

  // Webhook на Гари.
  const payload = {
    event: 'new_application',
    application_id: id,
    seller_id: user.id,
    data: fresh,
  };
  const firstAttempt = await tryWebhook(env, request, payload, 1);
  if (firstAttempt.ok) {
    return json({ ok: true, webhook_status: 'delivered', attempt: 1 });
  }
  // Не получилось с первого раза — повторим в фоне ещё 2 раза с задержкой 30 сек.
  if (ctx && typeof ctx.waitUntil === 'function') {
    ctx.waitUntil(retryWebhook(env, request, payload, 2));
  }
  return json({ ok: true, webhook_status: 'pending_retry', attempt: 1 });
}

async function tryWebhook(env, request, payload, attempt) {
  if (!env.GARY_WEBHOOK_URL) {
    await writeAudit(env, request, {
      is_agent: false,
      action: 'webhook_skipped',
      target_type: 'application',
      target_id: payload.application_id,
      metadata: { reason: 'no_GARY_WEBHOOK_URL', attempt },
    });
    return { ok: false, status: 0 };
  }
  try {
    const r = await fetch(env.GARY_WEBHOOK_URL, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(env.GARY_WEBHOOK_SECRET ? { authorization: `Bearer ${env.GARY_WEBHOOK_SECRET}` } : {}),
      },
      body: JSON.stringify(payload),
    });
    await writeAudit(env, request, {
      is_agent: false,
      action: r.ok ? 'webhook_sent' : 'webhook_failed',
      target_type: 'application',
      target_id: payload.application_id,
      metadata: { attempt, status: r.status },
    });
    return { ok: r.ok, status: r.status };
  } catch (e) {
    await writeAudit(env, request, {
      is_agent: false,
      action: 'webhook_failed',
      target_type: 'application',
      target_id: payload.application_id,
      metadata: { attempt, error: String(e && e.message || e) },
    });
    return { ok: false, status: 0 };
  }
}

async function retryWebhook(env, request, payload, attempt) {
  // До 3-й попытки включительно (1-я была сразу).
  while (attempt <= 3) {
    await new Promise(r => setTimeout(r, 30_000));
    const res = await tryWebhook(env, request, payload, attempt);
    if (res.ok) return;
    attempt++;
  }
}

// ---------- /sb/* — прокси на Supabase ----------
//
// Зачем: некоторые российские провайдеры через DPI режут TCP-соединения
// к `*.supabase.co`. Сайт открывается (Cloudflare Workers доходят), а
// auth/rest/storage API — нет, и пользователь видит «Failed to fetch».
// Решение — ходить на Supabase из браузера через наш же Worker:
//   js-клиент → workers.dev/sb/auth/v1/...  (виден провайдеру)
//   Worker     → supabase.co/auth/v1/...    (виден из CF, не из РФ)
//
// Обрабатывает auth, rest (PostgREST), storage. Realtime (WebSocket)
// не проксируется — в проекте не используется.

async function proxySupabase(request, env) {
  if (!env.SUPABASE_URL) {
    return new Response('SUPABASE_URL not configured', { status: 503 });
  }
  const inUrl = new URL(request.url);
  // '/sb/auth/v1/health' → '/auth/v1/health'
  const targetPath = inUrl.pathname.replace(/^\/sb/, '');
  const targetUrl = env.SUPABASE_URL.replace(/\/$/, '') + (targetPath || '/') + inUrl.search;

  // Чистим заголовки: host подставит fetch, cf-* — служебные CF, cookie
  // от нашего домена Supabase не ждёт.
  const headers = new Headers();
  for (const [k, v] of request.headers) {
    const kl = k.toLowerCase();
    if (kl === 'host') continue;
    if (kl === 'cookie') continue;
    if (kl === 'connection') continue;
    if (kl.startsWith('cf-')) continue;
    headers.set(k, v);
  }

  const init = {
    method: request.method,
    headers,
    redirect: 'manual',
  };
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    init.body = request.body;
  }

  let upstream;
  try {
    upstream = await fetch(targetUrl, init);
  } catch (e) {
    return new Response(
      JSON.stringify({ error: 'upstream_unreachable', detail: String(e && e.message || e) }),
      { status: 502, headers: { 'content-type': 'application/json' } }
    );
  }

  // Возвращаем ответ stream-style, чтобы крупные body (storage) шли потоком.
  const respHeaders = new Headers(upstream.headers);
  // Set-Cookie от supabase.co не нужен — у нас всё через Bearer-токены
  // в localStorage, а domain=supabase.co cookie всё равно бы не сохранялся
  // на нашем origin.
  respHeaders.delete('set-cookie');
  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: respHeaders,
  });
}

// ---------- Router ----------

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // Прокси Supabase (для пользователей, у которых провайдер режет supabase.co).
    // Обрабатываем до /api/, чтобы preflight OPTIONS на /sb/* тоже шёл сюда.
    if (url.pathname === '/sb' || url.pathname.startsWith('/sb/')) {
      return await proxySupabase(request, env);
    }

    if (request.method === 'OPTIONS' && url.pathname.startsWith('/api/')) {
      return new Response(null, { status: 204, headers: cors });
    }

    if (url.pathname.startsWith('/api/')) {
      if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE) {
        return withCors(json(
          { error: 'worker_not_configured', hint: 'set SUPABASE_URL var and SUPABASE_SERVICE_ROLE secret' },
          { status: 503 }
        ));
      }

      // POST /api/v1/admin/invite
      if (url.pathname === '/api/v1/admin/invite' && request.method === 'POST') {
        return withCors(await inviteUser(request, env));
      }

      // PATCH /api/v1/admin/users/:id/email
      const mEmail = url.pathname.match(/^\/api\/v1\/admin\/users\/([^/]+)\/email\/?$/);
      if (mEmail && request.method === 'PATCH') {
        return withCors(await changeEmail(request, env, mEmail[1]));
      }

      // Гари: отчёты менеджеров
      if (url.pathname === '/api/v1/reports/sellers' && request.method === 'GET') {
        return withCors(await listSellerReports(request, env));
      }
      if (url.pathname === '/api/v1/reports/sellers/aggregate' && request.method === 'GET') {
        return withCors(await aggregateSellerReports(request, env));
      }
      const mReport = url.pathname.match(/^\/api\/v1\/reports\/sellers\/([^/]+)\/(\d{4}-\d{2}-\d{2})\/?$/);
      if (mReport && request.method === 'GET') {
        return withCors(await getSellerReport(request, env, mReport[1], mReport[2]));
      }

      // DaData (для формы подключения компании). Доступен авторизованным менеджерам.
      if (url.pathname === '/api/v1/dadata/party' && request.method === 'GET') {
        return withCors(await dadataProxy(request, env, 'party'));
      }
      if (url.pathname === '/api/v1/dadata/address' && request.method === 'GET') {
        return withCors(await dadataProxy(request, env, 'address'));
      }
      if (url.pathname === '/api/v1/dadata/bank' && request.method === 'GET') {
        return withCors(await dadataProxy(request, env, 'bank'));
      }

      // Гари: заявки.
      if (url.pathname === '/api/v1/applications' && request.method === 'GET') {
        return withCors(await listApplications(request, env));
      }
      const mAppId = url.pathname.match(/^\/api\/v1\/applications\/([0-9a-f-]{36})\/?$/);
      if (mAppId && request.method === 'GET') {
        return withCors(await getApplication(request, env, mAppId[1]));
      }
      const mAppStatus = url.pathname.match(/^\/api\/v1\/applications\/([0-9a-f-]{36})\/status\/?$/);
      if (mAppStatus && request.method === 'PATCH') {
        return withCors(await patchApplicationStatus(request, env, mAppStatus[1]));
      }
      const mAppMsg = url.pathname.match(/^\/api\/v1\/applications\/([0-9a-f-]{36})\/messages\/?$/);
      if (mAppMsg && request.method === 'POST') {
        return withCors(await postApplicationMessage(request, env, mAppMsg[1]));
      }
      // Менеджер: «Передать Гари».
      const mAppSubmit = url.pathname.match(/^\/api\/v1\/applications\/([0-9a-f-]{36})\/submit\/?$/);
      if (mAppSubmit && request.method === 'POST') {
        return withCors(await submitApplication(request, env, ctx, mAppSubmit[1]));
      }

      return withCors(json({ error: 'not_found' }, { status: 404 }));
    }

    return env.ASSETS.fetch(request);
  },
};
