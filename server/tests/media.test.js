import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { AppError } from '../src/shared/errors/app-error.js';
import { processCatalogImage } from '../src/shared/infrastructure/media/image.js';
import { createBunnyStorage } from '../src/shared/infrastructure/media/bunny.js';
import { createMediaService } from '../src/modules/media/media.service.js';
import { Media } from '../src/modules/media/media.model.js';
import { mediaRepository } from '../src/modules/media/media.repository.js';
import { mediaFixture } from './helpers/media.js';
import { productFixture, simpleInput, variantInput } from './helpers/products.js';

const admin = { _id: 'a'.repeat(24), role: 'admin' };
const owner = { _id: 'b'.repeat(24), role: 'superAdmin' };
const auth = { async authorizeStaff(store, identity, roles) {
  if (store !== 'b2c' || !roles.includes(identity?.role)) throw new AppError(403, 'FORBIDDEN');
  return identity;
} };
const png = () => sharp({ create: { width: 30, height: 20, channels: 3, background: 'red' } }).png().toBuffer();
async function fixture() {
  const m = mediaFixture();
  let p;
  const media = createMediaService({ auth, ...m, logger: { error() {} }, targets: {
    product: { getStaff: (...args) => p.products.getStaff(...args) },
    category: { getStaff: (...args) => p.categories.getStaff(...args) },
  } });
  p = productFixture(auth, { media, mediaRows: m.rows });
  const root = await p.categories.create('b2c', admin, { slug: 'root', name: { ar: 'تصنيف', en: 'Root' } });
  return { ...m, ...p, media, root, mediaRows: m.rows };
}

test('image decoding rejects corrupt/spoofed/unsupported input and produces bounded WebP without metadata', async () => {
  const input = await sharp({ create: { width: 1800, height: 900, channels: 3, background: 'red' } })
    .withMetadata().jpeg().toBuffer();
  const output = await processCatalogImage(input, 'image/jpeg');
  assert.equal(output.width, 1600);
  assert.equal(output.height, 800);
  const metadata = await sharp(output.buffer).metadata();
  assert.equal(metadata.format, 'webp');
  assert.equal(metadata.exif, undefined);
  assert.equal(metadata.icc, undefined);
  for (const [buffer, type, code] of [[input, 'image/png', 'INVALID_IMAGE'],
    [Buffer.from('not an image'), 'image/jpeg', 'INVALID_IMAGE'], [input.subarray(0, 50), 'image/jpeg', 'INVALID_IMAGE'],
    [Buffer.alloc(5 * 1024 * 1024 + 1), 'image/png', 'INVALID_IMAGE'], [input, 'image/svg+xml', 'IMAGE_TYPE_UNSUPPORTED']]) {
    await assert.rejects(processCatalogImage(buffer, type), { code });
  }
  const huge = Buffer.from(await png());
  huge.writeUInt32BE(100000, 16);
  await assert.rejects(processCatalogImage(huge, 'image/png'), { code: 'INVALID_IMAGE' });
  const webp = await sharp(await png()).webp().toBuffer();
  assert.equal((await processCatalogImage(webp, 'image/webp')).width, 30);
});

test('Bunny adapter uses a private key, checksum, exact statuses, timeout and fixed object paths', async () => {
  const calls = [];
  let status = 201;
  const config = { endpoint: 'https://uk.storage.bunnycdn.com', zone: 'test-zone', accessKey: 'secret-storage-key', cdnOrigin: 'https://images.example' };
  const storage = createBunnyStorage(config, { request: async (url, options) => { calls.push({ url, options }); return { status }; } });
  const key = `narmer/b2c/catalog/product/${'1'.repeat(24)}/${'2'.repeat(24)}.webp`;
  await storage.upload(key, Buffer.from('test'));
  assert.equal(calls[0].url, `${config.endpoint}/test-zone/${key}`);
  assert.equal(calls[0].options.headers.AccessKey, config.accessKey);
  assert.match(calls[0].options.headers.Checksum, /^[A-F0-9]{64}$/);
  assert.equal(calls[0].options.redirect, 'error');
  assert.ok(calls[0].options.signal instanceof AbortSignal);
  assert.equal(storage.url(key), `${config.cdnOrigin}/${key}`);
  status = 200;
  await assert.rejects(storage.upload(key, Buffer.from('test')), { code: 'MEDIA_STORAGE_FAILED' });
  for (status of [200, 204, 404]) await storage.remove(key, storage.scope());
  status = 401;
  await assert.rejects(storage.remove(key, storage.scope()), error => error.code === 'MEDIA_STORAGE_FAILED' && !error.message.includes(config.accessKey));
  for (const bad of ['../file', 'narmer/', key.replace('narmer', 'petyard'), `${key}?allowRootDelete=true`]) {
    await assert.rejects(storage.remove(bad), { code: 'MEDIA_UNAVAILABLE' });
  }
  await assert.rejects(storage.remove(key, { ...storage.scope(), zone: 'another-zone' }), { code: 'MEDIA_UNAVAILABLE' });
  assert.throws(() => createBunnyStorage(null).assertReady(), { code: 'MEDIA_UNAVAILABLE' });
});

test('Bunny catalog paths allow native B2B products without allowing unrelated namespaces', async () => {
  const calls = [];
  const storage = createBunnyStorage({ endpoint: 'https://uk.storage.bunnycdn.com', zone: 'test-zone',
    accessKey: 'synthetic-key', cdnOrigin: 'https://images.example' }, {
    request: async (url, options) => { calls.push({ url, method: options.method }); return { status: options.method === 'PUT' ? 201 : 204 }; },
  });
  const key = `narmer/b2b/catalog/product/${'1'.repeat(24)}/${'2'.repeat(24)}.webp`;
  await storage.upload(key, Buffer.from('test'));
  assert.equal(storage.url(key), `https://images.example/${key}`);
  await storage.remove(key, storage.scope());
  assert.deepEqual(calls.map(call => call.method), ['PUT', 'DELETE']);
  for (const bad of [key.replace('/product/', '/category/'), key.replace('/product/', '/offer/'),
    key.replace('/b2b/', '/other/'), key.replace('/catalog/product/', '/leads/images/'),
    key.replace('/catalog/product/', '/orders/proofs/'), `${key}/../other.webp`]) {
    assert.throws(() => storage.url(bad), { code: 'MEDIA_UNAVAILABLE' });
    await assert.rejects(storage.upload(bad, Buffer.from('test')), { code: 'MEDIA_UNAVAILABLE' });
    await assert.rejects(storage.remove(bad, storage.scope()), { code: 'MEDIA_UNAVAILABLE' });
  }
  assert.equal(calls.length, 2);
});

test('failed and abandoned uploads remain durable until cleanup; live attachments never expire', async () => {
  const f = await fixture();
  const product = await f.products.create('b2c', admin, simpleInput(f.root.id));
  f.failUpload(true);
  await assert.rejects(f.media.upload('b2c', admin, 'product', product.id, await png(), 'image/png'), /upload failed/);
  assert.equal([...f.mediaRows.values()][0].status, 'uploading');
  assert.equal([...f.mediaRows.values()][0].objectKey.includes('petyard'), false);
  assert.equal((await f.media.cleanup()).removed, 0);
  f.advance(24 * 60 * 60 * 1000 + 1);
  assert.equal((await f.media.cleanup()).removed, 1);
  f.failUpload(false);
  const image = await f.media.upload('b2c', admin, 'product', product.id, await png(), 'image/png');
  await f.products.update('b2c', admin, product.id, { version: 0, imageIds: [image.id] });
  f.advance(48 * 60 * 60 * 1000);
  assert.deepEqual(await f.media.cleanup(), { removed: 0, failed: 0 });
  await assert.rejects(f.media.upload('b2c', { ...admin, role: 'moderator' }, 'product', product.id, await png(), 'image/png'), { code: 'FORBIDDEN' });
});

test('product images enforce target ownership, variant fallback, version conflicts and transactional rollback', async () => {
  const f = await fixture();
  const product = await f.products.create('b2c', admin, variantInput(f.root.id));
  const first = await f.media.upload('b2c', admin, 'product', product.id, await png(), 'image/png');
  const second = await f.media.upload('b2c', admin, 'product', product.id, await png(), 'image/png');
  const patch = { version: 0, imageIds: [first.id], variants: product.variants.map((variant, index) => ({ ...variant,
    imageIds: index ? [] : [second.id] })) };
  f.failAudit(true);
  await assert.rejects(f.products.update('b2c', admin, product.id, patch), /audit failed/);
  assert.ok([...f.mediaRows.values()].every(row => row.status === 'ready'));
  f.failAudit(false);
  const saved = await f.products.update('b2c', admin, product.id, patch);
  assert.ok([...f.mediaRows.values()].every(row => row.status === 'attached'));
  assert.deepEqual(saved.variants[1].images, []);
  const publicProduct = await f.products.getPublic('b2c', product.id, 'en');
  assert.equal(publicProduct.variants[1].images[0].id, first.id);
  assert.equal(publicProduct.variants[0].images[0].id, second.id);
  await assert.rejects(f.products.update('b2c', admin, product.id, { version: 0, imageIds: [] }), { code: 'PRODUCT_CONFLICT' });
  await assert.rejects(f.products.update('b2c', admin, product.id, { version: 1, imageIds: [first.id, first.id] }), { code: 'INVALID_PRODUCT' });
  const other = await f.products.create('b2c', admin, simpleInput(f.root.id, 'other'));
  await assert.rejects(f.products.update('b2c', admin, other.id, { version: 0, imageIds: [first.id] }), { code: 'MEDIA_CONFLICT' });
  f.failRemove(true);
  await f.products.update('b2c', admin, product.id, { version: 1, imageIds: [] });
  assert.equal(f.removals.length, 1);
  f.failRemove(false);
  assert.equal((await f.media.cleanup()).removed, 1);
  assert.equal((await f.products.getStaff('b2c', admin, product.id)).variants[0].images[0].id, second.id);
  await f.products.remove('b2c', owner, product.id);
  assert.equal((await f.media.cleanup()).removed, 0);
});

test('category images attach atomically and are retired only after successful replacement or deletion', async () => {
  const f = await fixture();
  const image = await f.media.upload('b2c', admin, 'category', f.root.id, await png(), 'image/png');
  const saved = await f.categories.update('b2c', admin, f.root.id, { imageId: image.id });
  assert.equal(saved.image.id, image.id);
  f.failAudit(true);
  await assert.rejects(f.categories.update('b2c', admin, f.root.id, { imageId: null }), /audit failed/);
  f.failAudit(false);
  assert.equal(f.removals.length, 0);
  await f.categories.create('b2c', admin, { slug: 'child', parentId: f.root.id, name: { ar: 'فرعي', en: 'Child' } });
  await assert.rejects(f.categories.remove('b2c', owner, f.root.id), { code: 'CATEGORY_HAS_CHILDREN' });
  assert.equal((await f.categories.getStaff('b2c', admin, f.root.id)).image.id, image.id);
  const product = await f.products.create('b2c', admin, simpleInput(f.root.id));
  await assert.rejects(f.products.update('b2c', admin, product.id, { version: 0, imageIds: [image.id] }), { code: 'MEDIA_CONFLICT' });
  await f.categories.update('b2c', admin, f.root.id, { imageId: null });
  assert.equal(f.removals.length, 1);
});

test('media repository binds attachments to scope/session and cleanup claims cannot select attached assets', () => {
  const session = { marker: true };
  const query = mediaRepository.attach('b2c', 'product', '1'.repeat(24), ['2'.repeat(24)], new Date(), session);
  assert.equal(query.getFilter().kind, 'product');
  assert.equal(query.getFilter().targetId, '1'.repeat(24));
  assert.deepEqual(query.getOptions().session, session);
  const cleanup = mediaRepository.claimCleanup('2'.repeat(24), new Date()).getFilter();
  assert.deepEqual(cleanup.$or[1].status.$in, ['uploading', 'ready']);
  assert.equal(Media.schema.indexes().some(([, options]) => options.expireAfterSeconds !== undefined), false);
});

test('background/manual cleanup drains multiple bounded batches and stops on failure rather than retrying in a loop', async () => {
  const m = mediaFixture();
  for (let index = 0; index < 125; index++) {
    const id = index.toString(16).padStart(24, '0');
    m.rows.set(id, { _id: id, store: 'b2c', kind: 'product', targetId: 'a'.repeat(24), status: 'deletePending',
      objectKey: `narmer/b2c/catalog/product/${'a'.repeat(24)}/${id}.webp`, ...m.storage.scope(), expiresAt: new Date(0) });
  }
  const media = createMediaService({ ...m, logger: { error() {} } });
  m.failRemove(true);
  assert.deepEqual(await media.cleanup(), { removed: 0, failed: 5 });
  assert.equal(m.removals.length, 5);
  m.failRemove(false);
  assert.deepEqual(await media.cleanup(), { removed: 125, failed: 0 });
  assert.equal(m.rows.size, 0);
});
