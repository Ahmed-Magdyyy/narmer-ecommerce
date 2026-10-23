import test from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { runTransaction } from '../src/shared/utils/transaction.js';

test('native transactions pass the session, preserve work errors, translate standalone failures and always close', async t => {
  let ends = 0;
  let failure;
  const session = {
    async withTransaction(work, options) {
      assert.equal(options.readConcern.level, 'snapshot');
      assert.equal(options.writeConcern.w, 'majority');
      if (failure) throw failure;
      return work(this);
    },
    async endSession() { ends++; },
  };
  t.mock.method(mongoose.connection, 'startSession', async () => session);
  assert.equal(await runTransaction(async current => { assert.equal(current, session); return 42; }), 42);
  const auditError = new Error('audit failed');
  await assert.rejects(runTransaction(async () => { throw auditError; }), error => error === auditError);
  failure = Object.assign(new Error('standalone'), { code: 20 });
  await assert.rejects(runTransaction(async () => {}), { code: 'TRANSACTIONS_REQUIRED', status: 503 });
  assert.equal(ends, 3);
});
