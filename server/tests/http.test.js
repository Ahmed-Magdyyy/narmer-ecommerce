import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { Router } from 'express';
import { body, query } from 'express-validator';
import { createApp } from '../src/app/app.js';
import { createApiRouter } from '../src/app/routes.js';
import { readEnv } from '../src/config/env.js';
import { testConfig as config, testEnv } from './helpers/config.js';
import { validateRequest } from '../src/shared/middleware/validate-request.js';
import { sendSuccess } from '../src/shared/utils/response.js';

async function fixture(t, overrides = {}) {
  const logs = [];
  const logger = { info: entry => logs.push(entry), error: entry => logs.push(entry) };
  let ready = true;
  const b2c = Router();
  const b2b = Router();
  b2c.post('/context', (req, res) => sendSuccess(res, { data: req.context }));
  b2b.post('/context', (req, res) => sendSuccess(res, { data: req.context }));
  b2c.get('/error', async () => {
    const error = new Error('Unexpected failure\nsecret-password should never be exposed');
    error.type = 'constructor';
    throw error;
  });
  b2c.post('/validate', [
    body('name').isString().bail().trim().notEmpty().withMessage('INVALID_FIELD'),
    query('page').isInt({ min: 1 }).withMessage('INVALID_FIELD').toInt(),
  ], validateRequest, (req, res) => sendSuccess(res, { data: req.validated }));
  const app = createApp({ ...config, ...overrides }, { logger, isReady: () => ready,
    apiRouter: createApiRouter({ b2c, b2b }) });
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise((resolve, reject) => {
    server.close(error => error ? reject(error) : resolve());
    server.closeAllConnections();
  }));
  const url = `http://127.0.0.1:${server.address().port}`;
  return { url, logs, setReady: value => { ready = value; } };
}

test('health endpoints distinguish live process from database readiness', async t => {
  const f = await fixture(t);
  const live = await fetch(`${f.url}/health/live`);
  assert.equal(live.status, 200);
  assert.equal((await live.json()).code, 'LIVE');
  assert.equal((await fetch(`${f.url}/health/ready`)).status, 200);
  f.setReady(false);
  assert.equal((await fetch(`${f.url}/health/ready`)).status, 503);
  assert.equal((await fetch(`${f.url}/health/live`)).status, 200);
});

test('locale precedence, negotiated language, and configured fallback', async t => {
  const f = await fixture(t, { defaultLocale: 'ar' });
  for (const [headers, expected] of [
    [{ 'X-Language': 'en', 'Accept-Language': 'ar' }, 'en'],
    [{ 'Accept-Language': 'en;q=0.4,ar-EG;q=0.9' }, 'ar'],
    [{ 'Accept-Language': 'ar;q=0,en;q=1' }, 'en'],
    [{ 'Accept-Language': 'fr' }, 'ar'],
    [{ 'Accept-Language': '*' }, 'ar'],
    // fetch sends Accept-Language: * by default; use an empty value to test absence.
    [{ 'Accept-Language': '' }, 'ar'],
  ]) {
    const response = await fetch(`${f.url}/missing`, { headers });
    assert.equal(response.headers.get('content-language'), expected);
    const result = await response.json();
    assert.equal(result.code, 'NOT_FOUND');
    if (expected === 'ar') assert.match(result.message, /[\u0600-\u06ff]/);
    assert.match(response.headers.get('vary'), /Accept-Language/);
  }
});

test('security headers, CORS allowlist, and server-generated request IDs', async t => {
  const f = await fixture(t);
  const response = await fetch(`${f.url}/health/live`, { headers: {
    Origin: 'https://shop.example', 'X-Request-Id': 'untrusted-id',
  } });
  assert.equal(response.headers.get('access-control-allow-origin'), 'https://shop.example');
  assert.equal(response.headers.get('x-powered-by'), null);
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
  const id = response.headers.get('x-request-id');
  assert.match(id, /^[0-9a-f-]{36}$/);
  assert.equal((await response.json()).requestId, id);
  assert.equal((await fetch(`${f.url}/health/live`, {
    headers: { Origin: 'https://untrusted.example' },
  })).status, 403);
  const preflight = await fetch(`${f.url}/api/v1/b2c/context`, { method: 'OPTIONS', headers: {
    Origin: 'https://shop.example', 'Access-Control-Request-Method': 'POST',
    'Access-Control-Request-Headers': 'content-type,x-language',
  } });
  assert.equal(preflight.status, 204);
});

test('integration origins allow credentialed preflight and reads while other loopback origins are denied', async t => {
  const f = await fixture(t, readEnv({ ...testEnv, NODE_ENV: 'production' }));
  for (const port of [5294, 5295, 5284, 5283]) {
    const origin = `http://127.0.0.1:${port}`;
    for (const store of ['b2b', 'b2c']) {
      const preflight = await fetch(`${f.url}/api/v1/${store}/auth/login`, { method: 'OPTIONS', headers: {
        Origin: origin, 'Access-Control-Request-Method': 'POST',
        'Access-Control-Request-Headers': 'authorization,content-type,x-language',
      } });
      assert.equal(preflight.status, 204);
      assert.equal(preflight.headers.get('access-control-allow-origin'), origin);
      assert.equal(preflight.headers.get('access-control-allow-credentials'), 'true');
      assert.match(preflight.headers.get('access-control-allow-methods'), /POST/);
      assert.equal(preflight.headers.get('access-control-allow-headers'), 'authorization,content-type,x-language');
    }
    const response = await fetch(`${f.url}/health/live`, { headers: { Origin: origin } });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('access-control-allow-origin'), origin);
    for (const header of ['X-Request-Id', 'Retry-After', 'RateLimit', 'RateLimit-Policy']) {
      assert.ok(response.headers.get('access-control-expose-headers').split(',').includes(header));
    }
  }
  for (const origin of ['http://127.0.0.1:5285', 'http://localhost:5284', 'https://127.0.0.1:5284']) {
    const response = await fetch(`${f.url}/health/live`, { headers: { Origin: origin } });
    assert.equal(response.status, 403);
    assert.equal((await response.json()).code, 'CORS_DENIED');
    assert.equal(response.headers.get('access-control-allow-origin'), null);
  }
});

test('malformed and oversized JSON use safe centralized errors', async t => {
  const f = await fixture(t);
  for (const [payload, expectedStatus, expectedCode] of [
    ['{"password":"secret-password",', 400, 'INVALID_JSON'],
    [JSON.stringify({ text: 'x'.repeat(110_000) }), 413, 'BODY_TOO_LARGE'],
  ]) {
    const response = await fetch(`${f.url}/api/v1/b2c/context`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: payload,
    });
    assert.equal(response.status, expectedStatus);
    const result = await response.json();
    assert.equal(result.code, expectedCode);
    assert.equal(JSON.stringify(result).includes('secret-password'), false);
  }
});

test('unexpected async errors hide secrets from responses and logs', async t => {
  const f = await fixture(t);
  const response = await fetch(`${f.url}/api/v1/b2c/error?token=secret-password`);
  assert.equal(response.status, 500);
  const result = await response.json();
  assert.equal(result.code, 'INTERNAL_ERROR');
  assert.equal(JSON.stringify([result, f.logs]).includes('secret-password'), false);
  assert.ok(f.logs.some(entry => entry.event === 'request_error' && entry.requestId === result.requestId));
});

test('validation exposes sanitized, whitelisted input and safe field errors', async t => {
  const f = await fixture(t);
  const response = await fetch(`${f.url}/api/v1/b2c/validate?page=2&role=superAdmin`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: '  Customer  ', role: 'superAdmin' }),
  });
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).data, {
    body: { name: 'Customer' }, params: {}, query: { page: 2 },
  });
  const invalid = await fetch(`${f.url}/api/v1/b2c/validate?page=secret-password`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Language': 'ar' },
    body: JSON.stringify({ name: '' }),
  });
  assert.equal(invalid.status, 422);
  const result = await invalid.json();
  assert.equal(result.errors.length, 2);
  assert.ok(result.errors.every(error => !Object.hasOwn(error, 'value')));
  assert.match(result.errors[0].message, /[\u0600-\u06ff]/);
  assert.equal(JSON.stringify(result).includes('secret-password'), false);
});

test('store context comes from the route, never client input', async t => {
  const f = await fixture(t);
  for (const store of ['b2c', 'b2b']) {
    const response = await fetch(`${f.url}/api/v1/${store}/context?store=other`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ store: 'other' }),
    });
    assert.equal((await response.json()).data.store, store);
  }
  assert.equal((await fetch(`${f.url}/api/v1/other/context`)).status, 404);
});
