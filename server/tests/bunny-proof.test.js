import test from 'node:test';
import assert from 'node:assert/strict';
import { createBunnyProofStorage } from '../src/shared/infrastructure/media/bunny-proof.js';

test('Bunny proofs use credentialed storage requests, bounded private reads and scoped cleanup without public URLs', async () => {
  const config = { zone: 'private-zone', accessKey: 'private-key', endpoint: 'https://storage.bunnycdn.com' };
  const key = `narmer/b2c/proofs/${'1'.repeat(24)}.webp`, calls = [];
  let response = () => new Response(null, { status: 201 });
  const storage = createBunnyProofStorage(config, { async request(url, options) { calls.push({ url, options }); return response(); } });
  await storage.upload(key, Buffer.from('webp'));
  assert.equal(calls[0].options.headers.AccessKey, 'private-key');
  assert.equal(calls[0].options.redirect, 'error'); assert.equal(calls[0].options.headers.Checksum.length, 64);
  assert.equal(storage.url, undefined);
  response = () => new Response(Buffer.from('image'), { status: 200 });
  assert.equal((await storage.read(key, storage.scope())).toString(), 'image');
  await assert.rejects(storage.read('narmer/b2c/catalog/product/x/y.webp'), { code: 'PROOF_STORAGE_UNAVAILABLE' });
  await assert.rejects(storage.read(key, { ...storage.scope(), zone: 'another-zone' }), { code: 'PROOF_STORAGE_UNAVAILABLE' });
  response = () => new Response(Buffer.alloc(5 * 1024 * 1024 + 1), { status: 200 });
  await assert.rejects(storage.read(key), { code: 'PROOF_STORAGE_FAILED' });
  response = () => new Response(null, { status: 404 }); await storage.remove(key, storage.scope());
  await assert.rejects(storage.read(key), { code: 'PROOF_STORAGE_FAILED' });
  await assert.rejects(createBunnyProofStorage(null).upload(key, Buffer.from('x')), { code: 'PROOF_STORAGE_UNAVAILABLE' });
});
