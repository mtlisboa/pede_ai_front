import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { createApp } from '../server.mjs';

const token = (suffix = 'old') => `header.${Buffer.from(JSON.stringify({ sub: '7', name: 'Cliente', role: 'SHOPPER' })).toString('base64url')}.${suffix}`;
const tokens = suffix => ({ access_token: token(suffix), refresh_token: `refresh-${suffix}`, expires_in: 900, refresh_token_expires_in: 86400, user_id: '7' });
async function fixture(t, handler = () => ({ ok: true }), options = {}) {
  const seen = [];
  const upstream = createServer(async (req, res) => {
    const chunks = []; for await (const c of req) chunks.push(c);
    const entry = { url: req.url, method: req.method, auth: req.headers.authorization, body: Buffer.concat(chunks).toString() };
    seen.push(entry);
    const result = await handler(entry);
    res.writeHead(result.status || 200, { 'Content-Type': result.contentType || 'application/json' });
    res.end(result.raw ?? JSON.stringify(result.data ?? result));
  }).listen(0, '127.0.0.1');
  await once(upstream, 'listening');
  const front = createApp({ upstream: `http://127.0.0.1:${upstream.address().port}`, stores: [{ id: 1, name: 'Minha loja' }], ...options }).listen(0, '127.0.0.1');
  await once(front, 'listening');
  t.after(async () => { front.closeAllConnections(); upstream.closeAllConnections(); await Promise.all([new Promise(r => front.close(r)), new Promise(r => upstream.close(r))]); });
  const base = `http://127.0.0.1:${front.address().port}`;
  const send = (path, method = 'GET', data, cookie) => fetch(base + path, { method, headers: { Origin: base, 'X-Pede-Client': 'web', 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) }, ...(data !== undefined ? { body: JSON.stringify(data) } : {}) });
  return { base, send, seen };
}

test('serves the app, module assets, health and only public configuration', async t => {
  const f = await fixture(t);
  const r = await f.send('/'); assert.equal(r.status, 200); assert.match(await r.text(), /lang="pt-BR"/);
  assert.match(r.headers.get('content-security-policy'), /frame-ancestors 'none'/);
  for (const path of ['/app.js', '/api.js', '/styles.css', '/favicon.svg', '/assets/food.jpg', '/healthz']) assert.equal((await f.send(path)).status, 200, path);
  assert.deepEqual(await (await f.send('/config')).json(), { stores: [{ id: 1, name: 'Minha loja', description: '' }] });
  assert.equal((await f.send('/server.mjs')).status, 404);
  assert.equal((await f.send('/%2e%2e%2fserver.mjs')).status, 404);
  assert.equal(f.seen.length, 0);
});

test('login keeps tokens out of JavaScript and uses HttpOnly session cookies', async t => {
  const f = await fixture(t, () => ({ data: tokens('login') }));
  const r = await f.send('/backend/auth/user/verify-code', 'POST', { phone_number: '5583999999999', code: '123456' });
  assert.equal(r.status, 200);
  const data = await r.json();
  assert.deepEqual(data.user, { user_id: '7', name: 'Cliente', role: 'SHOPPER' });
  assert.equal(data.access_token, undefined); assert.equal(data.refresh_token, undefined);
  const cookies = r.headers.getSetCookie(); assert.equal(cookies.length, 2);
  for (const c of cookies) { assert.match(c, /HttpOnly/); assert.match(c, /SameSite=Strict/); }
  assert.equal(f.seen[0].url, '/auth/user/verify-code');
});

test('forwards public food and restaurant search with repeated filters', async t => {
  const f = await fixture(t, entry => ({ data: { url: entry.url } }));
  const r = await f.send('/backend/api/v1/search?q=burger&filters=entrega&filters=lanches');
  assert.equal(r.status, 200);
  assert.equal((await r.json()).url, '/api/v1/search?q=burger&filters=entrega&filters=lanches');
  assert.equal(f.seen[0].auth, undefined);
});

test('rejects cross-origin writes and paths outside the API allowlist', async t => {
  const f = await fixture(t);
  const r = await fetch(f.base + '/backend/api/v1/carts', { method: 'POST', headers: { Origin: 'https://other.test', 'Content-Type': 'application/json', 'X-Pede-Client': 'web' }, body: '{}' });
  assert.equal(r.status, 403);
  assert.equal((await f.send('/backend/auth/user/7/block', 'POST', {})).status, 404);
  assert.equal((await f.send('/backend/api/v1/webhooks/uazapi', 'POST', {})).status, 404);
  assert.equal((await f.send('/backend/https://other.test')).status, 404);
  assert.equal(f.seen.length, 0);
});

test('preserves cart expected_version, decimals, query params and 409 conflicts', async t => {
  const f = await fixture(t, entry => entry.method === 'PATCH' ? { status: 409, data: { detail: 'Versão desatualizada' } } : { data: { total_amount: '32.90', version: 3, items: [] } });
  const cookie = `pede_access=${token()}`;
  const r = await f.send('/backend/api/v1/carts/current/items/8?store_id=1', 'PATCH', { expected_version: 2, quantity: 3 }, cookie);
  assert.equal(r.status, 409); assert.equal((await r.json()).detail, 'Versão desatualizada');
  assert.equal(f.seen[0].auth, `Bearer ${token()}`);
  assert.equal(f.seen[0].url, '/api/v1/carts/current/items/8?store_id=1');
  assert.deepEqual(JSON.parse(f.seen[0].body), { expected_version: 2, quantity: 3 });
  const cart = await (await f.send('/backend/api/v1/carts/current?store_id=1', 'GET', undefined, cookie)).json();
  assert.equal(cart.total_amount, '32.90');
});

test('refreshes an expired access token once and retries the authorized request', async t => {
  const f = await fixture(t, entry => {
    if (entry.url === '/auth/user/refresh-token') return { data: tokens('new') };
    return entry.auth === `Bearer ${token('new')}` ? { data: { id_user: 7 } } : { status: 401, data: { detail: 'expired' } };
  });
  const r = await f.send('/backend/api/v1/users/me', 'GET', undefined, `pede_access=${token()}; pede_refresh=refresh-old`);
  assert.equal(r.status, 200); assert.equal((await r.json()).id_user, 7);
  assert.equal(f.seen.length, 3); assert.match(r.headers.get('set-cookie'), /pede_access=/);
});

test('expired refresh clears cookies instead of retrying forever', async t => {
  const f = await fixture(t, () => ({ status: 401, data: { detail: 'expired' } }));
  const r = await f.send('/backend/api/v1/users/me', 'GET', undefined, `pede_access=${token()}; pede_refresh=expired`);
  assert.equal(r.status, 401); assert.match(r.headers.get('set-cookie'), /Max-Age=0/); assert.equal(f.seen.length, 2);
});

test('forwards empty 204 responses and logout clears both cookies', async t => {
  const f = await fixture(t, entry => entry.url === '/auth/user/logout' ? { data: { is_valid: true } } : { status: 204 });
  const r = await f.send('/backend/api/v1/products/10', 'DELETE'); assert.equal(r.status, 204); assert.equal(await r.text(), '');
  const logout = await f.send('/session/logout', 'POST', {}, `pede_access=${token()}; pede_refresh=refresh-old`);
  assert.equal(logout.status, 200); assert.equal(logout.headers.getSetCookie().length, 2);
  assert.ok(logout.headers.getSetCookie().every(c => c.includes('Max-Age=0')));
});

test('forwards real kitchen transitions and preserves errors', async t => {
  const f = await fixture(t, entry => entry.url.endsWith('/ready') ? { status: 409, data: { detail: 'Ticket ainda não está em preparo' } } : { data: { status: 'PREPARING' } });
  const claim = await f.send('/backend/api/v1/kitchen/tickets/12/claim', 'POST', {});
  assert.equal((await claim.json()).status, 'PREPARING');
  const ready = await f.send('/backend/api/v1/kitchen/tickets/12/ready', 'POST', {});
  assert.equal(ready.status, 409);
});

test('does not turn HTML upstream errors into successful API responses', async t => {
  const f = await fixture(t, () => ({ status: 502, contentType: 'text/html', raw: '<h1>Bad Gateway</h1>' }));
  const r = await f.send('/backend/api/v1/products?store_id=1'); assert.equal(r.status, 502);
  assert.match((await r.json()).detail, /inesperada/);
});

test('only proxies valid product images and includes the authenticated token', async t => {
  const f = await fixture(t, () => ({ contentType: 'image/png', raw: 'image' }));
  const r = await f.send('/media/products/photo.png', 'GET', undefined, `pede_access=${token()}`);
  assert.equal(r.status, 200); assert.equal(f.seen[0].url, '/uploads/products/photo.png');
  assert.equal(f.seen[0].auth, `Bearer ${token()}`);
  assert.equal((await f.send('/media/products/other/file.png')).status, 400);
});

test('product photo upload preserves binary bytes and remains protected by origin checks', async t => {
  const f = await fixture(t);
  const data = Buffer.from([0, 255, 128, 13, 10, 42]);
  const upstream = createServer(async (req, res) => {
    const chunks = []; for await (const chunk of req) chunks.push(chunk);
    assert.deepEqual(Buffer.concat(chunks), data);
    assert.equal(req.headers['content-type'], 'application/octet-stream');
    assert.equal(req.headers.authorization, 'Bearer owner');
    res.writeHead(200, { 'Content-Type': 'application/json' }); res.end('{"image_url":"/uploads/products/test.webp"}');
  }).listen(0, '127.0.0.1');
  await once(upstream, 'listening');
  const front = createApp({ upstream: `http://127.0.0.1:${upstream.address().port}` }).listen(0, '127.0.0.1');
  await once(front, 'listening');
  t.after(() => { front.closeAllConnections(); upstream.closeAllConnections(); front.close(); upstream.close(); });
  const base = `http://127.0.0.1:${front.address().port}`;
  const headers = { Origin: base, 'X-Pede-Client': 'web', 'Content-Type': 'application/octet-stream', Cookie: 'pede_access=owner' };
  assert.equal((await fetch(base + '/backend/api/v1/products/1/image', { method: 'POST', headers, body: data })).status, 200);
  assert.equal((await fetch(base + '/backend/api/v1/products/1/image', { method: 'POST', headers: { ...headers, Origin: 'https://foreign.example' }, body: data })).status, 403);
  assert.equal((await fetch(base + '/backend/api/v1/products', { method: 'POST', headers, body: data })).status, 415);
  for (const path of ['manage', 'categories']) assert.equal((await f.send('/backend/api/v1/products/' + path)).status, 200);
});

test('merchant OAuth binds callbacks to an HttpOnly browser nonce and keeps session cookies', async t => {
  const f = await fixture(t, entry => entry.url.endsWith('/authorize') ? { authorization_url: 'https://auth.mercadopago.com/authorization?state=test' } : { connected: true });
  const start = await f.send('/backend/api/v1/stores/me/mercado-pago/authorize', 'POST', { browser_nonce: 'attacker', redirect_uri: 'https://attacker.test' }, 'pede_access=owner');
  assert.equal(start.status, 200);
  const cookie = start.headers.getSetCookie().find(c => c.startsWith('pede_mp_nonce='));
  assert.match(cookie, /HttpOnly; SameSite=Lax/);
  const sent = JSON.parse(f.seen[0].body);
  assert.match(sent.browser_nonce, /^[a-zA-Z0-9_-]{43}$/);
  assert.equal(sent.redirect_uri, f.base + '/oauth/mercado-pago/callback');
  assert.equal((await f.send('/backend/api/v1/stores/me/mercado-pago/complete', 'POST', { state: 'state', code: 'code' }, 'pede_access=owner')).status, 400);
  const complete = await f.send('/backend/api/v1/stores/me/mercado-pago/complete', 'POST', { state: 'state', code: 'code', browser_nonce: 'attacker' }, `pede_access=owner; ${cookie.split(';')[0]}`);
  assert.equal(complete.status, 200);
  assert.equal(JSON.parse(f.seen.at(-1).body).browser_nonce, sent.browser_nonce);
  assert.match(complete.headers.getSetCookie()[0], /Max-Age=0/);
  const page = await f.send('/oauth/mercado-pago/callback?code=private-code&state=state');
  assert.equal(page.status, 200);
  assert.equal(page.headers.get('referrer-policy'), 'no-referrer');
  assert.doesNotMatch(await page.text(), /private-code/);
  assert.equal((await f.send('/oauth-callback.js')).status, 200);
});


test('password identifiers and contact verification pass through without creating premature sessions', async t => {
  const f = await fixture(t, entry => entry.url === '/auth/user/login'
    ? { status: 403, data: { detail: { error: 'contact_verification_required', message: 'Confirme seus contatos' } } }
    : { status: 202, data: { is_valid: true, message: 'Código enviado' } });
  const login = await f.send('/backend/auth/user/login', 'POST', { identifier: 'owner.test', password: 'example-password' });
  assert.equal(login.status, 403);
  assert.equal((await login.json()).detail.error, 'contact_verification_required');
  assert.equal(login.headers.get('set-cookie'), null);
  for (const channel of ['email', 'phone']) {
    const data = { identifier: 'owner.test', password: 'example-password', channel };
    const sent = await f.send('/backend/auth/credentials/request-code', 'POST', data);
    assert.equal(sent.status, 202);
    assert.deepEqual(JSON.parse(f.seen.at(-1).body), data);
    assert.equal(sent.headers.get('set-cookie'), null);
    const verified = await f.send('/backend/auth/credentials/verify-code', 'POST', { ...data, code: '123456' });
    assert.equal(verified.status, 202);
  }
  assert.equal((await f.send('/backend/auth/merchant/mercado-pago/authorize', 'POST', {})).status, 404);
});
