import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import mongoose from 'mongoose';
import { createReportsService } from '../src/modules/reports/reports.service.js';
import { ReportOrder } from '../src/modules/reports/reports.model.js';
import { reportOrder, reportRange } from './helpers/reports.js';

const uri = process.env.NARMER_TEST_MONGODB_URI;
test('real MongoDB reports preserve snapshot money/categories, distinct orders, cohort/event dates, status changes and Cairo DST', { skip: !uri }, async t => {
  const dbName = `narmer_test_${randomUUID().replaceAll('-', '').slice(0, 24)}`;
  await mongoose.connect(uri, { dbName, serverSelectionTimeoutMS: 5000, bufferCommands: false });
  t.after(async () => {
    try {
      assert.equal(mongoose.connection.name, dbName); assert.match(dbName, /^narmer_test_[a-f0-9]{24}$/);
      for (const row of await mongoose.connection.db.listCollections({}, { nameOnly: true }).toArray()) await mongoose.connection.db.dropCollection(row.name);
      assert.equal((await mongoose.connection.db.listCollections({}, { nameOnly: true }).toArray()).length, 0);
    } finally { await mongoose.disconnect(); }
  });
  await ReportOrder.init();
  const id = number => new mongoose.Types.ObjectId(number.toString(16).padStart(24, '0'));
  const first = reportOrder(1);
  first.items.push({ ...structuredClone(first.items[0]), variantId: 'c'.repeat(24), quantity: 1, lineTotal: 4000, couponDiscount: 0, lineTotalAfterDiscount: 4000 });
  first.totals = { subtotal: 14000, discountAmount: 1000, shippingFee: 5000, total: 18000 };
  const legacy = reportOrder(7, { createdAt: new Date(reportRange.from) });
  legacy.items[0].category = null; legacy.items[0].productId = 'd'.repeat(24);
  const rows = [first,
    reportOrder(2, { status: 'pending', payment: { method: 'cod' } }),
    reportOrder(3, { status: 'canceled', payment: { method: 'cod' }, refund: { amount: 14000, at: new Date('2026-01-15T10:00:00Z'), actorId: id(1) }, stockRestored: true }),
    reportOrder(4, { status: 'returned', refund: { amount: 14000, at: new Date('2026-02-02T10:00:00Z'), actorId: id(1) }, stockRestored: true }),
    reportOrder(5, { createdAt: new Date('2025-12-31T10:00:00Z') }),
    reportOrder(6, { createdAt: new Date(reportRange.to), payment: { method: 'cod', cashCollectedAt: new Date(reportRange.to) } }), legacy,
    reportOrder(8, { status: 'accepted', createdAt: new Date('2025-12-20T10:00:00Z'), payment: { method: 'instapay', verifiedAt: new Date('2026-01-03T10:00:00Z') } }),
  ];
  await ReportOrder.insertMany(rows);
  await ReportOrder.collection.insertOne({ ...reportOrder(9), _id: id(9), store: 'b2b' });
  const auth = { async authorizeStaff() {} }, products = { async getReportMetadata(ids) { return ids.includes('a'.repeat(24)) ? [{ id: 'a'.repeat(24), slug: 'current-slug', image: null }] : []; } };
  const reports = createReportsService({ auth, products });
  const before = await ReportOrder.find().sort({ _id: 1 }).lean();
  const overview = await reports.overview('b2c', {}, reportRange);
  assert.deepEqual(overview.metrics, { ordersPlaced: 5, unitsPlaced: 11, placedOrderAmount: 74000, pendingOrders: 1, averagePlacedOrderAmount: 14800 });
  assert.equal(overview.recentOrders.length, 5); assert.equal(overview.topProducts[0].quantity, 3); assert.equal(overview.topProducts[0].orderCount, 1);
  assert.equal(overview.topProducts[0].merchandiseAmount, 13000); assert.equal(overview.topProducts[0].slug, 'current-slug');
  assert.equal(overview.topProducts[1].slug, null); assert.equal(overview.topProducts[1].image, null);
  assert.equal(overview.trend.reduce((sum, row) => sum + row.placedOrderAmount, 0), 74000);
  const finance = await reports.finance('b2c', {}, reportRange);
  assert.deepEqual(finance.orderAmounts, { subtotal: 54000, couponDiscountAmount: 5000, shippingFee: 25000, total: 74000 });
  assert.deepEqual(finance.collectionMarkers, { instapayVerifiedAmount: 14000, codCollectedAmount: 60000, totalRecordedAmount: 74000 });
  assert.deepEqual(finance.refundMarkers, { amount: 14000, orderCount: 1 });
  assert.equal(finance.byStatus.find(row => row.status === 'delivered').count, 2);
  assert.equal(finance.byPaymentMethod.find(row => row.method === 'instapay').orderCount, 0);
  assert.equal(finance.byPaymentMethod.find(row => row.method === 'instapay').recordedCollectionAmount, 14000);
  assert.equal(finance.trend.reduce((sum, row) => sum + row.refundMarkerAmount, 0), 14000);
  const performance = await reports.performance('b2c', {}, { ...reportRange, limit: 1 }, 'ar');
  assert.deepEqual(performance.pagination, { page: 1, limit: 1, total: 2, pages: 2 });
  assert.equal(performance.items[0].name, 'قميص قديم');
  assert.deepEqual(performance.categories, [
    { categoryId: 'b'.repeat(24), name: 'التصنيف القديم', quantity: 3, merchandiseAmount: 13000 },
    { categoryId: null, name: null, quantity: 2, merchandiseAmount: 9000 },
  ]);
  assert.equal((await reports.performance('b2c', {}, { ...reportRange, page: 2, limit: 1 })).items[0].productId, 'd'.repeat(24));
  assert.deepEqual(await ReportOrder.find().sort({ _id: 1 }).lean(), before, 'reports must never change payment/stock/history');
  await ReportOrder.updateOne({ _id: id(2) }, { $set: { status: 'delivered' } });
  assert.equal((await reports.performance('b2c', {}, reportRange)).items[0].quantity, 5);
  await ReportOrder.updateOne({ _id: id(2) }, { $set: { status: 'returned' } });
  assert.equal((await reports.performance('b2c', {}, reportRange)).items[0].quantity, 3);
  const empty = await reports.overview('b2c', {}, { from: '2026-03-01T00:00:00Z', to: '2026-03-02T00:00:00Z' });
  assert.equal(empty.metrics.ordersPlaced, 0); assert.equal(empty.metrics.averagePlacedOrderAmount, null);
  for (const [number, from, to, hours] of [
    [10, '2026-04-23T22:00:00Z', '2026-04-24T21:00:00Z', 23],
    [11, '2026-10-28T21:00:00Z', '2026-10-29T22:00:00Z', 25],
  ]) {
    await ReportOrder.insertMany([reportOrder(number, { createdAt: new Date(from) })]);
    const dst = await reports.overview('b2c', {}, { from, to });
    assert.equal(dst.trend.length, 1); assert.equal(dst.trend[0].ordersPlaced, 1);
    assert.equal(Date.parse(dst.trend[0].bucketEnd) - Date.parse(dst.trend[0].bucketStart), hours * 3600000);
    const week = await reports.overview('b2c', {}, { from, to, interval: 'week' }); assert.equal(week.trend[0].ordersPlaced, 1);
    const month = await reports.overview('b2c', {}, { from, to, interval: 'month' }); assert.equal(month.trend[0].ordersPlaced, 1);
  }
});
