import test from 'node:test';
import assert from 'node:assert/strict';
import { planOfferSlugs } from '../scripts/backfill-wholesale-slugs.js';
import { isOfferSlug, offerSlugBase, offerSlugCandidate } from '../src/modules/wholesale/wholesale.slug.js';

const offer = (digit, name = 'Logo hoodie', extra = {}) => ({ _id: digit.repeat(24), name: { en: name }, ...extra });

test('slug generation handles normalization, empty names, ID ambiguity and bounded suffixes', () => {
  assert.equal(offerSlugBase('  Logo   Hoodie! '), 'logo-hoodie');
  assert.equal(offerSlugBase('هودي'), 'offer');
  assert.equal(offerSlugBase('f'.repeat(24)), 'f'.repeat(24) + '-offer');
  assert.equal(offerSlugBase('x'.repeat(200)).length, 96);
  assert.equal(offerSlugBase('Ｃｏｔｔｏｎ'), 'cotton');
  const candidate = offerSlugCandidate('x'.repeat(148) + '-y', 23);
  assert.equal(candidate.length, 150); assert.ok(isOfferSlug(candidate));
  for (const value of [null, '', 'UPPER', 'a--b', 'a/b', '%61', 'a'.repeat(151), 'a'.repeat(24)]) assert.equal(isOfferSlug(value), false);
});

test('backfill allocates deterministically across hidden offers, saved history and deleted reservations', () => {
  const saved = offer('3', 'Renamed', { slug: 'saved', slugAliases: ['logo-hoodie'] });
  const keys = [{ _id: 'logo-hoodie-2', offerId: '9'.repeat(24) }];
  const rows = [offer('2'), saved, offer('1')];
  const before = structuredClone(rows);
  const result = planOfferSlugs(rows, keys);
  assert.deepEqual(result.entries.map(row => row.slug), ['logo-hoodie-3', 'logo-hoodie-4', 'saved']);
  assert.deepEqual(rows, before);
  const persisted = result.entries.map(row => offer(row.offerId[0], 'Changed', { slug: row.slug, slugAliases: row.slugAliases }));
  const registry = [...keys, ...result.reservations.map(row => ({ _id: row.slug, offerId: row.offerId }))];
  const repeated = planOfferSlugs(persisted, registry);
  assert.deepEqual(repeated.reservations, []); assert.ok(repeated.entries.every(row => row.existing));
});

test('backfill stops on ambiguous ownership or malformed saved history', () => {
  assert.throws(() => planOfferSlugs([offer('1', 'A', { slug: 'same', slugAliases: [] }), offer('2', 'B', { slug: 'same', slugAliases: [] })], []), /conflicting owners/);
  assert.throws(() => planOfferSlugs([offer('1', 'A', { slug: 'same', slugAliases: ['same'] })], []), /Invalid saved URL history/);
  assert.throws(() => planOfferSlugs([offer('1', 'A', { slug: 'Invalid', slugAliases: [] })], []), /Invalid persisted/);
});
