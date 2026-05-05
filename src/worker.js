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
      const m = url.pathname.match(/^\/api\/v1\/admin\/users\/([^/]+)\/email\/?$/);
      if (m && request.method === 'PATCH') {
        return withCors(await changeEmail(request, env, m[1]));
      }

      return withCors(json({ error: 'not_found' }, { status: 404 }));
    }

    return env.ASSETS.fetch(request);
  },
};
