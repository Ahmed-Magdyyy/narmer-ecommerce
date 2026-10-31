import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createVercelHandler } from '../src/app/vercel.js';
import { testConfig } from './helpers/config.js';

const response = () => ({
  writeHead(status, headers) { this.status = status; this.headers = headers; },
  end(body) { this.body = body; },
});

test('Vercel routing targets the exported handler and concurrent requests share completed initialization', async () => {
  const configuration = JSON.parse(readFileSync(new URL('../vercel.json', import.meta.url), 'utf8'));
  assert.equal(configuration.builds[0].src, 'src/app/vercel.js');
  assert.equal(configuration.routes[0].dest, configuration.builds[0].src);
  assert.deepEqual(configuration.builds[0].config.includeFiles,['src/shared/infrastructure/email/assets/narmer-logo.png']);
  assert.ok(readFileSync(new URL('../'+configuration.builds[0].config.includeFiles[0],import.meta.url)).length>0);
  let connections = 0, initializations = 0, apps = 0, completed = false;
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const handler = createVercelHandler({ readConfig: () => testConfig,
    db: { async connectDatabase(config) { assert.equal(config, testConfig); connections++; }, isDatabaseReady: () => completed },
    async initialize() { initializations++; await gate; completed = true; },
    makeApp(config, { isReady }) { apps++; return (req, res) => { assert.equal(isReady(), true); res.end('ready'); }; },
  });
  const first = response(), second = response();
  const requests = [handler({}, first), handler({}, second)];
  await Promise.resolve();
  assert.equal(first.body, undefined);
  assert.equal(second.body, undefined);
  release();
  await Promise.all(requests);
  assert.deepEqual([connections, initializations, apps], [1, 1, 1]);
  assert.equal(first.body, 'ready');
  assert.equal(second.body, 'ready');
  await handler({}, response());
  assert.equal(connections, 1);
});

test('Vercel startup failures are sanitized and a later request can retry initialization', async () => {
  let attempts = 0;
  const logs = [];
  const handler = createVercelHandler({ readConfig: () => testConfig,
    db: { async connectDatabase() { if (++attempts === 1) throw new Error('private-database-credential'); }, isDatabaseReady: () => true },
    initialize: async () => {}, makeApp: () => (req, res) => res.end('ready'),
    logger: { error: entry => logs.push(entry) },
  });
  const failed = response();
  await handler({}, failed);
  assert.equal(failed.status, 503);
  assert.equal(failed.headers['Cache-Control'], 'no-store');
  const body = JSON.parse(failed.body);
  assert.equal(body.code, 'NOT_READY');
  assert.equal(body.success, false);
  assert.deepEqual(body.errors, []);
  assert.ok(body.requestId);
  assert.ok(!JSON.stringify({ logs, body }).includes('private-database-credential'));
  const retry = response();
  await handler({}, retry);
  assert.equal(retry.body, 'ready');
  assert.equal(attempts, 2);
});
