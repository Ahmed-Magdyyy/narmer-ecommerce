import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { startServer } from '../src/app/lifecycle.js';
import { testConfig } from './helpers/config.js';

const config = { ...testConfig, port: 0 };
const logger = { info() {}, error() {} };

test('startup waits for MongoDB and shutdown drains HTTP then disconnects once', async t => {
  let connected = false;
  let disconnects = 0;
  let releaseConnection;
  const connection = new Promise(resolve => { releaseConnection = resolve; });
  const db = {
    async connectDatabase() { await connection; connected = true; },
    isDatabaseReady: () => connected,
    async disconnectDatabase() { disconnects++; connected = false; },
  };
  let started = false;
  const startup = startServer(config, { db, logger }).then(runtime => { started = true; return runtime; });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(started, false);
  releaseConnection();
  const runtime = await startup;
  t.after(() => runtime.shutdown());
  assert.equal((await fetch(`http://127.0.0.1:${runtime.server.address().port}/health/ready`)).status, 200);
  const first = runtime.shutdown();
  assert.equal(first, runtime.shutdown());
  await first;
  assert.equal(disconnects, 1);
  assert.equal(runtime.server.listening, false);
});

test('database connection failure prevents HTTP startup', async () => {
  const failure = new Error('database unavailable');
  await assert.rejects(startServer(config, { logger, db: {
    connectDatabase: async () => { throw failure; },
  } }), error => error === failure);
});

test('identity index initialization failure disconnects MongoDB before HTTP startup', async () => {
  const failure = new Error('index initialization failed');
  let disconnected = false;
  await assert.rejects(startServer(config, { logger,
    initialize: async () => { throw failure; },
    db: { async connectDatabase() {}, async disconnectDatabase() { disconnected = true; } },
  }), error => error === failure);
  assert.equal(disconnected, true);
});

test('a busy HTTP port disconnects the database after startup failure', async t => {
  const occupied = createServer();
  occupied.listen(0, config.host);
  await once(occupied, 'listening');
  t.after(() => new Promise(resolve => occupied.close(resolve)));
  let disconnected = false;
  await assert.rejects(startServer({ ...config, port: occupied.address().port }, { logger, db: {
    async connectDatabase() {},
    isDatabaseReady: () => true,
    async disconnectDatabase() { disconnected = true; },
  } }), { code: 'EADDRINUSE' });
  assert.equal(disconnected, true);
});

test('configured catalog and private-proof cleanup share one hourly timer without overlap and stop at shutdown', async t => {
  let callback;
  let unreferenced = false;
  let cleared = false;
  const timer = { unref() { unreferenced = true; } };
  const originalInterval = globalThis.setInterval;
  const originalClear = globalThis.clearInterval;
  t.mock.method(globalThis, 'setInterval', (work, delay) => {
    if (delay !== 60 * 60 * 1000) return originalInterval(work, delay);
    callback = work;
    return timer;
  });
  t.mock.method(globalThis, 'clearInterval', actual => {
    if (actual !== timer) return originalClear(actual);
    cleared = true;
  });
  let calls = 0;
  let proofCalls = 0;
  let leadCalls = 0;
  let release;
  const runtime = await startServer({ ...config, bunnyPublic: {},bunnyProof:{} }, { logger,
    db: { async connectDatabase() {}, isDatabaseReady: () => true, async disconnectDatabase() {} },
    cleanupMedia: () => { calls++; return new Promise(resolve => { release = resolve; }); },
    cleanupProofs: async () => {proofCalls++;return {removed:0,failed:0};},
    cleanupLeadImages: async () => {leadCalls++;return {removed:0,failed:0};},
  });
  t.after(() => runtime.shutdown());
  assert.equal(unreferenced, true);
  const running = callback();
  await callback();
  assert.equal(calls, 1);
  release({ removed: 1, failed: 0 });
  await running;
  assert.equal(proofCalls,1);
  assert.equal(leadCalls,1);
  await runtime.shutdown();
  assert.equal(cleared, true);
  await callback();
  assert.equal(calls, 1);
  assert.equal(proofCalls,1);
  assert.equal(leadCalls,1);
});

test('configured customer-email worker does not overlap and finishes before shutdown disconnects MongoDB', async t => {
  let tick, cleared = false, release, calls = 0, disconnected = false;
  const timer = { unref() {} }, originalInterval = globalThis.setInterval, originalClear = globalThis.clearInterval;
  t.mock.method(globalThis, 'setInterval', (work, delay) => { if (delay !== 60000) return originalInterval(work, delay); tick = work; return timer; });
  t.mock.method(globalThis, 'clearInterval', actual => { if (actual !== timer) return originalClear(actual); cleared = true; });
  const runtime = await startServer({ ...config, smtp: {}, notificationLinks: { b2c: 'configured' } }, { logger,
    db: { async connectDatabase() {}, isDatabaseReady: () => true, async disconnectDatabase() { disconnected = true; } },
    deliverEmails: () => { calls++; return new Promise(resolve => { release = resolve; }); },
  });
  t.after(() => runtime.shutdown()); const running = tick(); await Promise.resolve(); tick(); assert.equal(calls, 1);
  const stopping = runtime.shutdown(); assert.equal(cleared, true); assert.equal(disconnected, false);
  release({ sent: 1, failed: 0, skipped: 0 }); await running; await stopping; assert.equal(disconnected, true);
  tick(); assert.equal(calls, 1);
});
