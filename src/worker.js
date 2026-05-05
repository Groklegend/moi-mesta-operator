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

// ---------- Router ----------

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

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

      // Гари: отчёты продажников
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

      return withCors(json({ error: 'not_found' }, { status: 404 }));
    }

    return env.ASSETS.fetch(request);
  },
};
