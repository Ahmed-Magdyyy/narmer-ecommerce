import test from 'node:test';
import assert from 'node:assert/strict';
import { categoryFixture } from './helpers/categories.js';
import { Category } from '../src/modules/categories/categories.model.js';
import { categoriesRepository } from '../src/modules/categories/categories.repository.js';

const superAdmin = { userId: 'a'.repeat(24), role: 'superAdmin' };
const admin = { ...superAdmin, role: 'admin' };
const auth = { async authorizeStaff(store, identity, roles) {
  if (!roles.includes(identity.role)) throw Object.assign(new Error('forbidden'), { code: 'FORBIDDEN' });
  return { _id: identity.userId };
} };
const input = (slug, parentId = null) => ({ slug, parentId, name: { ar: `تصنيف ${slug}`, en: slug }, description: { en: 'Description' } });

test('three-level categories reject missing parents, cycles, and moves that make descendants too deep', async () => {
  const f = categoryFixture(auth);
  const root = await f.categories.create('b2c', admin, input('clothing'));
  const child = await f.categories.create('b2c', admin, input('shirts', root.id));
  const leaf = await f.categories.create('b2c', admin, input('summer', child.id));
  await assert.rejects(f.categories.create('b2c', admin, input('extra', leaf.id)), { code: 'CATEGORY_DEPTH_EXCEEDED' });
  await assert.rejects(f.categories.update('b2c', admin, root.id, { parentId: child.id }), { code: 'CATEGORY_CYCLE' });
  await assert.rejects(f.categories.update('b2c', admin, root.id, { parentId: root.id }), { code: 'CATEGORY_CYCLE' });
  await assert.rejects(f.categories.create('b2c', admin, input('missing', 'f'.repeat(24))), { code: 'CATEGORY_PARENT_NOT_FOUND' });
  const other = await f.categories.create('b2c', admin, input('other'));
  await assert.rejects(f.categories.update('b2c', admin, root.id, { parentId: other.id }), { code: 'CATEGORY_DEPTH_EXCEEDED' });
  await f.categories.update('b2c', admin, leaf.id, { parentId: other.id.toUpperCase() });
  assert.equal((await f.categories.getStaff('b2c', admin, leaf.id.toUpperCase())).parentId, other.id);
  await f.categories.update('b2c', admin, child.id, { parentId: null });
  assert.equal((await f.categories.getStaff('b2c', admin, child.id)).parentId, null);
  await assert.rejects(f.categories.create('b2b', superAdmin, input('wrong')), { code: 'INVALID_STORE' });
});

test('inactive ancestors hide branches without changing descendants; public content follows locale', async () => {
  const f = categoryFixture(auth);
  const root = await f.categories.create('b2c', admin, input('root'));
  const child = await f.categories.create('b2c', admin, input('child', root.id));
  const leaf = await f.categories.create('b2c', admin, input('leaf', child.id));
  const publicTree = await f.categories.browse('b2c', 'ar');
  assert.equal(publicTree[0].children[0].children[0].id, leaf.id);
  assert.match(publicTree[0].name, /تصنيف/);
  assert.equal(publicTree[0].description, 'Description');
  await f.categories.update('b2c', admin, root.id, { isActive: false });
  assert.deepEqual(await f.categories.browse('b2c', 'en'), []);
  await assert.rejects(f.categories.getPublic('b2c', leaf.id, 'en'), { code: 'CATEGORY_NOT_FOUND' });
  assert.equal(f.rows.get(child.id).isActive, true);
  await f.categories.update('b2c', admin, leaf.id, { isActive: false });
  await f.categories.update('b2c', admin, root.id, { isActive: true });
  assert.equal((await f.categories.browse('b2c', 'en'))[0].children[0].children.length, 0);
  const patched = await f.categories.update('b2c', admin, child.id, { name: { ar: 'قميص' }, store: 'b2b' });
  assert.equal(patched.name.ar, 'قميص');
  assert.equal(patched.name.en, 'child');
  assert.equal(f.rows.get(child.id).store, 'b2c');
  const listing = await f.categories.list('b2c', admin, { page: 2, limit: 1 });
  assert.equal(listing.items.length, 1);
  assert.equal(listing.pagination.total, 3);
});

test('deletion never cascades, checks inactive children and product collaborator, and denies ordinary admins', async () => {
  const f = categoryFixture(auth);
  const root = await f.categories.create('b2c', admin, input('root'));
  const child = await f.categories.create('b2c', admin, { ...input('child', root.id), isActive: false });
  await assert.rejects(f.categories.remove('b2c', superAdmin, root.id), { code: 'CATEGORY_HAS_CHILDREN' });
  await assert.rejects(f.categories.remove('b2c', admin, child.id), { code: 'FORBIDDEN' });
  f.assigned.add(`b2c:${child.id}`);
  await assert.rejects(f.categories.remove('b2c', superAdmin, child.id), { code: 'CATEGORY_HAS_PRODUCTS' });
  f.assigned.clear();
  await f.categories.remove('b2c', superAdmin, child.id);
  await f.categories.remove('b2c', superAdmin, root.id);
  assert.equal(f.rows.size, 0);
  assert.equal(f.audits.at(-1).action, 'deleted');
});

test('transaction rollback preserves mutations on audit failure; serialized competing moves cannot form a cycle', async () => {
  const f = categoryFixture(auth);
  f.failAudit(true);
  await assert.rejects(f.categories.create('b2c', admin, input('rollback')), /audit failed/);
  assert.equal(f.rows.size, 0);
  f.failAudit(false);
  const a = await f.categories.create('b2c', admin, input('a'));
  const b = await f.categories.create('b2c', admin, input('b'));
  const results = await Promise.allSettled([
    f.categories.update('b2c', admin, a.id, { parentId: b.id }),
    f.categories.update('b2c', admin, b.id, { parentId: a.id }),
  ]);
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal(results.find(result => result.status === 'rejected').reason.code, 'CATEGORY_CYCLE');
  f.failAudit(true);
  await assert.rejects(f.categories.remove('b2c', superAdmin, a.id), /audit failed/);
  assert.ok(f.rows.has(a.id));
  assert.equal(f.audits.length, 3);
});

test('slug conflicts and role guards are explicit; Mongo queries use the same transaction and store', async () => {
  const f = categoryFixture(auth);
  await f.categories.create('b2c', admin, input('unique'));
  await assert.rejects(f.categories.create('b2c', admin, input('unique')), { code: 'CATEGORY_SLUG_EXISTS' });
  for (const role of ['moderator', 'user']) {
    await assert.rejects(f.categories.create('b2c', { ...admin, role }, input(role)), { code: 'FORBIDDEN' });
    await assert.rejects(f.categories.list('b2c', { ...admin, role }), { code: 'FORBIDDEN' });
  }
  const session = { marker: true };
  const lock = categoriesRepository.lockTree('b2c', session);
  assert.deepEqual(lock.getFilter(), { _id: 'b2c' });
  assert.equal(lock.getUpdate().$inc.revision, 1);
  const update = categoriesRepository.update('b2c', superAdmin.userId, { 'name.ar': 'اسم' }, session);
  assert.deepEqual(update.getFilter(), { store: 'b2c', _id: superAdmin.userId });
  assert.deepEqual(update.getOptions().session, session);
  assert.deepEqual(update.getUpdate().$set, { 'name.ar': 'اسم' });
  assert.ok(Category.schema.indexes().some(([keys, options]) => keys.store === 1 && keys.slug === 1 && options.unique));
  await new Category({ store: 'b2c', ...input('valid') }).validate();
});

test('racing parent deletion and child creation leaves no dangling parent', async () => {
  const f = categoryFixture(auth);
  const parent = await f.categories.create('b2c', admin, input('parent'));
  const results = await Promise.allSettled([
    f.categories.remove('b2c', superAdmin, parent.id),
    f.categories.create('b2c', admin, input('child', parent.id)),
  ]);
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  for (const row of f.rows.values()) {
    if (row.parentId) assert.ok(f.rows.has(row.parentId));
  }
});
