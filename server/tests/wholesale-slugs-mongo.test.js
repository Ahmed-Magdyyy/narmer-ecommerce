import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import mongoose from 'mongoose';
import { createWholesaleService } from '../src/modules/wholesale/wholesale.service.js';
import { wholesaleRepository } from '../src/modules/wholesale/wholesale.repository.js';
import { WholesaleOffer, WholesaleOfferKey, WholesaleAudit } from '../src/modules/wholesale/wholesale.model.js';
import { previewOfferSlugs, applyOfferSlugPlan } from '../scripts/backfill-wholesale-slugs.js';
import { nativeInput, offerInput } from './helpers/wholesale.js';

test('real MongoDB enforces permanent offer keys, concurrent writes, rollback and repeatable guarded backfill',
  { skip: !process.env.NARMER_TEST_MONGODB_URI }, async t => {
    const dbName = `narmer_test_${randomUUID().replaceAll('-', '').slice(0, 24)}`;
    await mongoose.connect(process.env.NARMER_TEST_MONGODB_URI, { dbName, serverSelectionTimeoutMS: 5000, bufferCommands: false });
    t.after(async () => {
      try {
        assert.equal(mongoose.connection.name, dbName); assert.match(dbName, /^narmer_test_[a-f0-9]{24}$/);
        for (const row of await mongoose.connection.db.listCollections({}, { nameOnly: true }).toArray()) await mongoose.connection.db.dropCollection(row.name);
        assert.equal((await mongoose.connection.db.listCollections({}, { nameOnly: true }).toArray()).length, 0);
      } finally { await mongoose.disconnect(); }
    });
    await wholesaleRepository.initialize();
    const actor = { _id: new mongoose.Types.ObjectId() };
    const dependencies = { auth: { async authorizeStaff() { return actor; } },
      products: { async lockForCart() {}, async getForWholesale() { return []; }, async getWholesaleProductIds() { return []; } }, media: {} };
    const wholesale = createWholesaleService(dependencies);
    const product = await wholesale.createProduct('b2b', actor, nativeInput);
    const offers = await Promise.all(Array.from({ length: 6 }, () => wholesale.createOffer('b2b', actor, { ...offerInput('b2b', product.id), isActive: true })));
    assert.equal(new Set(offers.map(row => row.slug)).size, 6);
    assert.equal(await WholesaleOfferKey.countDocuments(), 6);
    const race = await Promise.allSettled(offers.slice(0, 2).map(row => wholesale.updateOffer('b2b', actor, row.id, { version: 0, slug: 'shared-target' })));
    assert.equal(race.filter(row => row.status === 'fulfilled').length, 1);
    assert.equal(race.find(row => row.status === 'rejected').reason.code, 'WHOLESALE_SLUG_EXISTS');
    let current = race.find(row => row.status === 'fulfilled').value;
    const before = await WholesaleOffer.findById(current.id).lean(), count = await WholesaleAudit.countDocuments();
    const failing = createWholesaleService({ ...dependencies, repository: { ...wholesaleRepository, async audit() { throw new Error('synthetic URL audit failure'); } } });
    await assert.rejects(failing.updateOffer('b2b', actor, current.id, { version: 1, slug: 'rollback-target' }), /synthetic URL audit failure/);
    assert.equal(await WholesaleOfferKey.findById('rollback-target'), null);
    assert.deepEqual(await WholesaleOffer.findById(current.id).lean(), before); assert.equal(await WholesaleAudit.countDocuments(), count);
    current = await wholesale.updateOffer('b2b', actor, current.id, { version: 1, slug: 'latest-target' });
    for (const key of [...current.slugAliases, current.slug, current.id]) assert.equal((await wholesale.resolvePublic('b2b', key)).slug, current.slug);
    await assert.rejects(WholesaleOfferKey.create({ _id: current.slug, store: 'b2b', offerId: offers[2].id }), { code: 11000 });
    await assert.rejects(wholesale.updateOffer('b2b', actor, current.id, { version: 2, slug: current.slugAliases[0] }), { code: 'WHOLESALE_SLUG_EXISTS' });
    const versionRace = await Promise.allSettled(['concurrent-one', 'concurrent-two'].map(slug => wholesale.updateOffer('b2b', actor, current.id, { version: 2, slug })));
    assert.equal(versionRace.filter(row => row.status === 'fulfilled').length, 1);
    assert.equal(versionRace.find(row => row.status === 'rejected').reason.code, 'WHOLESALE_CONFLICT');
    current = versionRace.find(row => row.status === 'fulfilled').value;
    await wholesale.removeOffer('b2b', actor, current.id);
    for (const key of [...current.slugAliases, current.slug, current.id]) await assert.rejects(wholesale.resolvePublic('b2b', key), { code: 'WHOLESALE_OFFER_NOT_FOUND' });
    await assert.rejects(wholesale.updateOffer('b2b', actor, offers[2].id, { version: 0, slug: current.slug }), { code: 'WHOLESALE_SLUG_EXISTS' });
    const hidden = offers[3];
    await wholesale.updateProduct('b2b', actor, product.id, { version: 0, isActive: false });
    await assert.rejects(wholesale.resolvePublic('b2b', hidden.slug), { code: 'WHOLESALE_OFFER_NOT_FOUND' });
    assert.equal((await wholesale.getOffer('b2b', actor, hidden.id)).slug, hidden.slug);
    const legacyId = new mongoose.Types.ObjectId(), timestamp = new Date('2026-01-01T00:00:00Z');
    await WholesaleOffer.collection.insertOne({ _id: legacyId, store: 'b2b', ...offerInput('b2b', product.id), productId: new mongoose.Types.ObjectId(product.id),
      isActive: false, version: 7, createdAt: timestamp, updatedAt: timestamp });
    const legacy = await WholesaleOffer.collection.findOne({ _id: legacyId });
    const plan = await previewOfferSlugs(mongoose.connection, true);
    assert.equal(plan.entries.filter(row => !row.existing).length, 1);
    await assert.rejects(applyOfferSlugPlan(mongoose.connection, { ...plan, database: 'wrong' }), /another database/);
    await assert.rejects(applyOfferSlugPlan(mongoose.connection, { ...plan, noPublishedLinks: false }), /Confirm/);
    const tampered = structuredClone(plan); tampered.entries.at(-1).slug = 'tampered-preview';
    await assert.rejects(applyOfferSlugPlan(mongoose.connection, tampered), /Catalog or preview changed/);
    assert.equal(await WholesaleOfferKey.countDocuments(), (await previewOfferSlugs(mongoose.connection, true)).entries.length + 3);
    const reserve = wholesaleRepository.reserveOfferKey;
    wholesaleRepository.reserveOfferKey = async (...args) => { await reserve(...args); throw new Error('synthetic backfill failure'); };
    try { await assert.rejects(applyOfferSlugPlan(mongoose.connection, plan), /synthetic backfill failure/); }
    finally { wholesaleRepository.reserveOfferKey = reserve; }
    assert.deepEqual(await WholesaleOffer.collection.findOne({ _id: legacyId }), legacy);
    const result = await applyOfferSlugPlan(mongoose.connection, plan); assert.equal(result.migrated, 1);
    const migrated = await WholesaleOffer.collection.findOne({ _id: legacyId });
    const { slug, slugAliases, ...unchanged } = migrated;
    assert.deepEqual(unchanged, legacy); assert.ok(slug); assert.deepEqual(slugAliases, []);
    const repeated = await previewOfferSlugs(mongoose.connection, true);
    assert.ok(repeated.entries.every(row => row.existing)); assert.equal(repeated.reservations.length, 0);
    assert.deepEqual(await applyOfferSlugPlan(mongoose.connection, repeated), { migrated: 0, reserved: 0 });
    const stale = await previewOfferSlugs(mongoose.connection, true);
    await WholesaleOffer.collection.updateOne({ _id: legacyId }, { $set: { 'name.en': 'Concurrent edit' } });
    await assert.rejects(applyOfferSlugPlan(mongoose.connection, stale), /Catalog or preview changed/);
  });
