import { randomBytes } from 'node:crypto';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve, extname, sep } from 'node:path';

const root = resolve(fileURLToPath(new URL('./public/', import.meta.url)));
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.jpg': 'image/jpeg', '.png': 'image/png', '.svg': 'image/svg+xml', '.webp': 'image/webp' };
const ROUTES = [
  [/^\/api\/v1\/stores\/me\/mercado-pago$/, ['GET']],
  [/^\/api\/v1\/stores\/me\/mercado-pago\/(authorize|complete)$/, ['POST']],
  [/^\/api\/v1\/products\/manage$/, ['GET']],
  [/^\/api\/v1\/products\/categories$/, ['GET', 'POST']],
  [/^\/api\/v1\/products\/\d+\/image$/, ['POST']],
  [/^\/auth\/user\/(generate-code|verify-code|login)$/, ['POST']],
  [/^\/auth\/credentials\/(request-code|verify-code|username)$/, ['POST']],
  [/^\/api\/v1\/users$/, ['POST']],
  [/^\/api\/v1\/users\/me$/, ['GET', 'PUT', 'PATCH', 'DELETE']],
  [/^\/api\/v1\/products$/, ['GET', 'POST']],
  [/^\/api\/v1\/products\/\d+$/, ['GET', 'PUT', 'PATCH', 'DELETE']],
  [/^\/api\/v1\/search$/, ['GET']],
  [/^\/api\/v1\/carts$/, ['POST']],
  [/^\/api\/v1\/carts\/current$/, ['GET', 'DELETE']],
  [/^\/api\/v1\/carts\/current\/items$/, ['POST']],
  [/^\/api\/v1\/carts\/current\/items\/\d+$/, ['PUT', 'PATCH', 'DELETE']],
  [/^\/api\/v1\/carts\/current\/(validate|checkout)$/, ['POST']],
  [/^\/api\/v1\/carts\/\d+\/cancel-checkout$/, ['POST']],
  [/^\/api\/v1\/orders$/, ['GET', 'POST']],
  [/^\/api\/v1\/orders\/\d+$/, ['GET', 'PUT', 'PATCH', 'DELETE']],
  [/^\/api\/v1\/orders\/\d+\/status$/, ['PATCH']],
  [/^\/api\/v1\/orders\/\d+\/payments$/, ['GET', 'POST']],
  [/^\/api\/v1\/orders\/\d+\/payments\/\d+$/, ['GET', 'PUT', 'DELETE']],
  [/^\/api\/v1\/orders\/\d+\/payments\/\d+\/confirm$/, ['POST']],
  [/^\/api\/v1\/orders\/\d+\/receipts$/, ['GET']],
  [/^\/api\/v1\/orders\/\d+\/receipts\/\d+\/content$/, ['GET']],
  [/^\/api\/v1\/orders\/\d+\/receipts\/\d+\/review$/, ['POST']],
  [/^\/api\/v1\/kitchen\/tickets(?:\/\d+)?$/, ['GET']],
  [/^\/api\/v1\/kitchen\/tickets\/\d+\/(claim|ready)$/, ['POST']],
];

function cookies(req) {
  return Object.fromEntries((req.headers.cookie || '').split(';').map(x => {
    const index = x.indexOf('=');
    return [x.slice(0, index).trim(), x.slice(index + 1)];
  }));
}
function identity(token) {
  // Display metadata only. Every protected operation is authorized by the backend.
  try {
    const p = JSON.parse(Buffer.from(token.split('.')[1], 'base64url'));
    return { user_id: String(p.sub), name: String(p.name || ''), role: String(p.role || '') };
  } catch { return null; }
}
function json(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(data));
}
async function body(req, limit = 1024 * 1024) {
  const chunks = []; let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw Object.assign(new Error('Requisição muito grande.'), { status: 413 });
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

export function createApp(options = {}) {
  const upstream = new URL(options.upstream || process.env.API_UPSTREAM || 'http://127.0.0.1:8000');
  if (!['http:', 'https:'].includes(upstream.protocol) || upstream.username || upstream.password || upstream.pathname !== '/') throw new Error('API_UPSTREAM deve ser uma origem HTTP(S), sem caminho ou credenciais.');
  const secure = options.secure ?? process.env.COOKIE_SECURE === 'true';
  const origin = options.origin ?? process.env.PUBLIC_ORIGIN;
  const stores = options.stores ?? JSON.parse(process.env.STORES_JSON || '[]');
  if (!Array.isArray(stores) || stores.some(s => !Number.isSafeInteger(s.id) || s.id < 1 || typeof s.name !== 'string')) throw new Error('STORES_JSON deve conter lojas com id inteiro positivo e name.');
  const refreshes = new Map();
  function setSession(res, tokens) {
    const flags = `Path=/; HttpOnly; SameSite=Strict${secure ? '; Secure' : ''}`;
    // Access cookie survives token expiry so the server can refresh it transparently.
    const age = tokens ? Math.max(0, Number(tokens.refresh_token_expires_in) || 86400) : 0;
    res.setHeader('Set-Cookie', [
      `pede_access=${tokens?.access_token || ''}; Max-Age=${age}; ${flags}`,
      `pede_refresh=${tokens?.refresh_token || ''}; Max-Age=${age}; ${flags}`,
    ]);
  }
  async function fetchAPI(path, method, data, access, contentType = 'application/json') {
    return fetch(new URL(path, upstream), {
      method, redirect: 'manual', signal: AbortSignal.timeout(20000),
      headers: { Accept: 'application/json', ...(data ? { 'Content-Type': contentType } : {}), ...(access ? { Authorization: `Bearer ${access}` } : {}) },
      ...(data ? { body: data } : {}),
    });
  }
  async function refresh(token) {
    if (!refreshes.has(token)) {
      const promise = (async () => {
        const r = await fetchAPI('/auth/user/refresh-token', 'POST', JSON.stringify({ refresh_token: token }));
        const data = await r.json();
        if (!r.ok) throw Object.assign(new Error('Sua sessão expirou. Entre novamente.'), { status: 401 });
        return data;
      })();
      refreshes.set(token, promise);
      // Deduplicate refreshes arriving simultaneously, including rotating tokens.
      promise.finally(() => { const timer = setTimeout(() => refreshes.delete(token), 1000); timer.unref(); }).catch(() => {});
    }
    return refreshes.get(token);
  }
  return createServer(async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'same-origin');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
    try {
      const url = new URL(req.url, 'http://localhost');
      const path = url.pathname;
      if (!['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) return json(res, 405, { detail: 'Método não permitido.' });
      if (!['GET', 'HEAD'].includes(req.method)) {
        const expectedOrigin = origin || `http${secure ? 's' : ''}://${req.headers.host}`;
        if (req.headers.origin !== expectedOrigin || req.headers['sec-fetch-site'] === 'cross-site' || req.headers['x-pede-client'] !== 'web') return json(res, 403, { detail: 'Origem da requisição não permitida.' });
        if (!(req.headers['content-type'] || '').startsWith('application/json') && !(req.method === 'POST' && /^\/backend\/api\/v1\/products\/\d+\/image$/.test(path) && req.headers['content-type'] === 'application/octet-stream')) return json(res, 415, { detail: 'Use application/json.' });
      }
      if (path === '/oauth/mercado-pago/callback' && req.method === 'GET') {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' });
        return res.end(await readFile(resolve(root, 'oauth-callback.html')));
      }
      if (path === '/healthz' && req.method === 'GET') return json(res, 200, { status: 'ok' });
      if (path === '/config' && req.method === 'GET') return json(res, 200, { stores: stores.map(s => ({ id: s.id, name: s.name, description: s.description || '' })) });
      const session = cookies(req);
      if (path === '/session' && req.method === 'GET') {
        let access = session.pede_access;
        // Validate/refresh session via the backend, never use an unverified JWT for access.
        if (session.pede_refresh) {
          const tokens = await refresh(session.pede_refresh);
          setSession(res, tokens); access = tokens.access_token;
        } else return json(res, 200, { user: null });
        return json(res, 200, { user: identity(access) });
      }
      if (path === '/session/logout' && req.method === 'POST') {
        try {
          if (session.pede_access && session.pede_refresh) {
            const r = await fetchAPI('/auth/user/logout', 'POST', JSON.stringify({ access_token: session.pede_access, refresh_token: session.pede_refresh }), session.pede_access);
            if (!r.ok) return json(res, r.status, { detail: 'Não foi possível encerrar a sessão no servidor. Tente novamente.' });
          }
        } finally { setSession(res, null); }
        return json(res, 200, { message: 'Sessão encerrada.' });
      }
      if (path.startsWith('/backend/')) {
        const target = path.slice('/backend'.length);
        if (!ROUTES.some(([pattern, methods]) => pattern.test(target) && methods.includes(req.method))) return json(res, 404, { detail: 'Recurso não disponível.' });
        let access = session.pede_access;
        let data = ['GET', 'HEAD'].includes(req.method) ? undefined : await body(req, target.endsWith('/image') ? 5 * 1024 * 1024 : 1024 * 1024);
        const oauthStart = target === '/api/v1/stores/me/mercado-pago/authorize';
        const oauthComplete = target === '/api/v1/stores/me/mercado-pago/complete';
        let nonce;
        if (oauthStart || oauthComplete) {
          nonce = oauthStart ? randomBytes(32).toString('base64url') : session.pede_mp_nonce;
          if (!nonce || !/^[a-zA-Z0-9_-]{43}$/.test(nonce)) return json(res, 400, { detail: 'Autorização expirada. Inicie a conexão novamente neste navegador.' });
          let payload;
          try { payload = JSON.parse(data || '{}'); } catch { return json(res, 400, { detail: 'JSON inválido.' }); }
          if (!payload || Array.isArray(payload) || typeof payload !== 'object') return json(res, 400, { detail: 'Dados inválidos.' });
          data = JSON.stringify({ ...payload, browser_nonce: nonce, ...(oauthStart ? { redirect_uri: `${origin || `http${secure ? 's' : ''}://${req.headers.host}`}/oauth/mercado-pago/callback` } : {}) });
        }
        let response = await fetchAPI(target + url.search, req.method, data, access, req.headers['content-type']);
        if (response.status === 401 && session.pede_refresh && !target.startsWith('/auth/')) {
          const tokens = await refresh(session.pede_refresh);
          setSession(res, tokens); access = tokens.access_token;
          response = await fetchAPI(target + url.search, req.method, data, access, req.headers['content-type']);
        }
        if (response.status === 204) {
          if (target === '/api/v1/users/me' && req.method === 'DELETE') setSession(res, null);
          res.writeHead(204, { 'Cache-Control': 'no-store' }); return res.end();
        }
        const isReceiptContent = /^\/api\/v1\/orders\/\d+\/receipts\/\d+\/content$/.test(target);
        if (isReceiptContent && response.ok) {
          const contentType = response.headers.get('content-type') || 'application/octet-stream';
          const disposition = response.headers.get('content-disposition') || 'attachment; filename="comprovante"';
          res.writeHead(response.status, {
            'Content-Type': contentType,
            'Content-Disposition': disposition,
            'X-Content-Type-Options': 'nosniff',
            'Cache-Control': 'no-store',
          });
          return res.end(Buffer.from(await response.arrayBuffer()));
        }
        if (!(response.headers.get('content-type') || '').includes('application/json')) return json(res, 502, { detail: 'O serviço retornou uma resposta inesperada.' });
        const result = await response.json();
        if (response.ok && (oauthStart || oauthComplete)) {
          const prior = res.getHeader('Set-Cookie') || [];
          res.setHeader('Set-Cookie', [...(Array.isArray(prior) ? prior : [prior]),
            `pede_mp_nonce=${oauthStart ? nonce : ''}; Path=/; Max-Age=${oauthStart ? 600 : 0}; HttpOnly; SameSite=Lax${secure ? '; Secure' : ''}`]);
        }
        if (response.ok && result.access_token && result.refresh_token) {
          setSession(res, result);
          return json(res, response.status, { user: identity(result.access_token) });
        }
        if (response.status === 401 && !target.startsWith('/auth/')) setSession(res, null);
        return json(res, response.status, result);
      }
      if (path.startsWith('/media/products/') && ['GET', 'HEAD'].includes(req.method)) {
        const name = path.slice('/media/products/'.length);
        if (!/^[a-zA-Z0-9_.-]+\.(jpg|jpeg|png|webp|avif|svg)$/i.test(name)) return json(res, 400, { detail: 'Imagem inválida.' });
        const r = await fetchAPI('/uploads/products/' + name, 'GET', undefined, session.pede_access);
        if (!r.ok || !(r.headers.get('content-type') || '').startsWith('image/')) return json(res, 404, { detail: 'Imagem não disponível.' });
        // Backend images currently require auth. Never bypass backend authorization.
        res.writeHead(200, { 'Content-Type': r.headers.get('content-type'), 'Cache-Control': 'private, max-age=60' });
        return res.end(req.method === 'HEAD' ? undefined : Buffer.from(await r.arrayBuffer()));
      }
      if (!['GET', 'HEAD'].includes(req.method)) return json(res, 404, { detail: 'Página não encontrada.' });
      const filename = resolve(root, '.' + decodeURIComponent(path === '/' ? '/index.html' : path));
      if (!filename.startsWith(root + sep) || !MIME[extname(filename)]) return json(res, 404, { detail: 'Arquivo não encontrado.' });
      const content = await readFile(filename);
      res.writeHead(200, { 'Content-Type': MIME[extname(filename)], 'Cache-Control': 'no-cache' });
      res.end(req.method === 'HEAD' ? undefined : content);
    } catch (error) {
      if (error.status === 401) setSession(res, null);
      const status = error.status || (error.code === 'ENOENT' ? 404 : 502);
      json(res, status, { detail: error.status ? error.message : status === 404 ? 'Página não encontrada.' : 'Não foi possível conectar ao serviço. Tente novamente em instantes.' });
    }
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const server = createApp();
  server.listen(Number(process.env.PORT || 8080), process.env.HOST || '0.0.0.0', () => console.log(`Pede Aí disponível na porta ${process.env.PORT || 8080}`));
  for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => server.close(() => process.exit(0)));
}
