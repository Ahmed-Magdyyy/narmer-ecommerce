import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import mongoose from 'mongoose';
import { WholesaleOffer, WholesaleOfferKey } from '../src/modules/wholesale/wholesale.model.js';
import { wholesaleRepository } from '../src/modules/wholesale/wholesale.repository.js';
import { isOfferSlug, offerSlugBase, offerSlugCandidate } from '../src/modules/wholesale/wholesale.slug.js';
import { runTransaction } from '../src/shared/utils/transaction.js';

export function planOfferSlugs(offers, keys) {
  const owners = new Map(keys.map(key => [key._id, String(key.offerId)]));
  const reservations = [];
  const claim = (slug, offerId) => {
    assert.ok(isOfferSlug(slug), 'Invalid persisted URL key; reconcile it before migration.');
    assert.ok(!owners.has(slug) || owners.get(slug) === offerId, 'URL key has conflicting owners; explicit reconciliation is required.');
    if (!owners.has(slug)) reservations.push({ slug, offerId });
    owners.set(slug, offerId);
  };
  const sorted = [...offers].sort((a, b) => String(a._id).localeCompare(String(b._id)));
  for (const offer of sorted) {
    if (offer.slug === undefined) {
      assert.ok(!offer.slugAliases?.length, 'An offer has aliases without a current slug.');
      continue;
    }
    assert.ok(Array.isArray(offer.slugAliases), 'Saved slugAliases must be an array.');
    assert.ok(!offer.slugAliases.includes(offer.slug) && new Set(offer.slugAliases).size === offer.slugAliases.length, 'Invalid saved URL history.');
    for (const key of [offer.slug, ...offer.slugAliases]) claim(key, String(offer._id));
  }
  const entries = sorted.map(offer => {
    const offerId = String(offer._id);
    if (offer.slug !== undefined) return { offerId, slug: offer.slug, slugAliases: [...offer.slugAliases], existing: true };
    const base = offerSlugBase(offer.name.en);
    let number = 1, slug = base;
    while (owners.has(slug)) slug = offerSlugCandidate(base, ++number);
    claim(slug, offerId);
    return { offerId, slug, slugAliases: [], existing: false };
  });
  return { entries, reservations };
}

export async function previewOfferSlugs(connection, noPublishedLinks = false, session = null) {
  const options = session ? { session } : {};
  const offers = await connection.db.collection(WholesaleOffer.collection.name).find({ store: 'b2b' }, options).sort({ _id: 1 }).toArray();
  const keys = await connection.db.collection(WholesaleOfferKey.collection.name).find({ store: 'b2b' }, options).sort({ _id: 1 }).toArray();
  return { format: 1, database: connection.name, noPublishedLinks,
    fingerprint: createHash('sha256').update(JSON.stringify({ offers, keys })).digest('hex'),
    ...planOfferSlugs(offers, keys) };
}

export async function applyOfferSlugPlan(connection, plan) {
  assert.equal(connection, mongoose.connection, 'Migration must use the connected default database.');
  assert.equal(plan.format, 1, 'Unsupported preview format.');
  assert.equal(plan.database, connection.name, 'Preview belongs to another database.');
  assert.equal(plan.noPublishedLinks, true, 'Confirm that no readable links were published before generating this preview.');
  // Create only the registry before the transaction; preview mode never creates collections/indexes.
  await WholesaleOfferKey.createCollection();
  return runTransaction(async session => {
    await wholesaleRepository.lock(session);
    const current = await previewOfferSlugs(connection, true, session);
    assert.deepEqual(current, plan, 'Catalog or preview changed; generate and review a fresh preview.');
    for (const { slug, offerId } of plan.reservations) await wholesaleRepository.reserveOfferKey('b2b', slug, offerId, session);
    for (const entry of plan.entries.filter(row => !row.existing)) {
      const result = await WholesaleOffer.collection.updateOne({ _id: new mongoose.Types.ObjectId(entry.offerId), store: 'b2b', slug: { $exists: false } },
        { $set: { slug: entry.slug, slugAliases: entry.slugAliases } }, { session });
      assert.equal(result.modifiedCount, 1, 'Offer changed during backfill.');
    }
    return { migrated: plan.entries.filter(row => !row.existing).length, reserved: plan.reservations.length };
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const { values } = parseArgs({ options: { preview: { type: 'string' }, apply: { type: 'string' }, 'no-published-links': { type: 'boolean', default: false } } });
    assert.ok(Boolean(values.preview) !== Boolean(values.apply), 'Use --preview <file> or --apply <reviewed-file>.');
    assert.match(process.env.MONGODB_URI ?? '', /^mongodb(?:\+srv)?:\/\//, 'MONGODB_URI is required.');
    await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 5000, autoIndex: false, autoCreate: false });
    if (values.apply) {
      const plan = JSON.parse(readFileSync(values.apply, 'utf8'));
      const result = await applyOfferSlugPlan(mongoose.connection, plan);
      const verified = await previewOfferSlugs(mongoose.connection, true);
      assert.ok(verified.entries.every(row => row.existing) && verified.reservations.length === 0, 'Backfill readback failed.');
      console.log(JSON.stringify({ event: 'wholesale_urls_backfilled', database: mongoose.connection.name, ...result, verified: true }));
    } else {
      const plan = await previewOfferSlugs(mongoose.connection, values['no-published-links']);
      writeFileSync(values.preview, JSON.stringify(plan, null, 2) + '\n', { flag: 'wx' });
      console.log(JSON.stringify({ event: 'wholesale_urls_preview', database: plan.database, offers: plan.entries.length, newSlugs: plan.entries.filter(row => !row.existing).length,
        reservations: plan.reservations.length, applyAllowed: plan.noPublishedLinks, output: values.preview }));
    }
  } catch (error) {
    console.error(JSON.stringify({ event: 'wholesale_url_migration_failed', code: error.code ?? 'MIGRATION_FAILED',
      ...(error instanceof assert.AssertionError ? { reason: error.message.split('\n')[0] } : {}) }));
    process.exitCode = 1;
  } finally { await mongoose.disconnect(); }
}
