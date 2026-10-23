import test from 'node:test';
import assert from 'node:assert/strict';
import { createBunnyLeadStorage } from '../src/shared/infrastructure/media/bunny-leads.js';

test('Bunny Lead images accept only scoped private B2B keys and bound provider reads', async () => {
  const config = { zone: 'private-zone', accessKey: 'synthetic-key', endpoint: 'https://storage.bunnycdn.com' };
  const key = `narmer/b2b/lead-images/${'1'.repeat(24)}.webp`, calls = [];
  let response = () => new Response(null, { status: 201 });
  const storage = createBunnyLeadStorage(config, { async request(url, options) { calls.push({ url, options }); return response(); } });
  await storage.upload(key, Buffer.from('webp'));
  assert.equal(calls[0].options.redirect, 'error'); assert.equal(calls[0].options.headers.AccessKey, config.accessKey);
  assert.match(calls[0].options.headers.Checksum, /^[A-F0-9]{64}$/); assert.equal(storage.url, undefined);
  for (const invalid of [`narmer/b2c/proofs/${'1'.repeat(24)}.webp`, '../other.webp', key.replace('.webp', '.png')]) {
    await assert.rejects(storage.read(invalid), { code: 'LEAD_STORAGE_UNAVAILABLE' });
  }
  await assert.rejects(storage.remove(key, { ...storage.scope(), zone: 'wrong-zone' }), { code: 'LEAD_STORAGE_UNAVAILABLE' });
  response = () => new Response(Buffer.from('image'), { status: 200 }); assert.equal((await storage.read(key, storage.scope())).toString(), 'image');
  response = () => new Response(Buffer.alloc(5 * 1024 * 1024 + 1), { status: 200 });
  await assert.rejects(storage.read(key), { code: 'LEAD_STORAGE_FAILED' });
  response = () => new Response(null, { status: 404 }); await storage.remove(key, storage.scope());
  await assert.rejects(storage.read(key), { code: 'LEAD_STORAGE_FAILED' });
  await assert.rejects(createBunnyLeadStorage(null).upload(key, Buffer.from('x')), { code: 'LEAD_STORAGE_UNAVAILABLE' });
});
