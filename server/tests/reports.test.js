import test from 'node:test';
import assert from 'node:assert/strict';
import { AppError } from '../src/shared/errors/app-error.js';
import { createReportsService, reportBuckets } from '../src/modules/reports/reports.service.js';
import { emptyReportRepository, reportRange } from './helpers/reports.js';

const auth = { async authorizeStaff(store, identity, roles) { if (!roles.includes(identity?.role)) throw new AppError(403, 'FORBIDDEN'); } };
const staff = { role: 'admin' }, products = { async getReportMetadata() { return []; } };
test('Cairo zero-fill boundaries handle spring/fall DST, Monday weeks, month edges and exclusive end', () => {
  const daily = (from, to) => reportBuckets(new Date(from), new Date(to), 'day');
  const spring = daily('2026-04-23T22:00:00Z', '2026-04-24T21:00:00Z');
  assert.deepEqual(spring, [{ key: '2026-04-24', bucketStart: '2026-04-23T22:00:00.000Z', bucketEnd: '2026-04-24T21:00:00.000Z' }]);
  const fall = daily('2026-10-28T21:00:00Z', '2026-10-29T22:00:00Z');
  assert.equal(fall.length, 1); assert.equal(Date.parse(fall[0].bucketEnd) - Date.parse(fall[0].bucketStart), 25 * 3600000);
  const week = reportBuckets(new Date('2026-01-01T10:00:00Z'), new Date('2026-01-02T10:00:00Z'), 'week');
  assert.equal(week[0].key, '2025-12-29'); assert.equal(week[0].bucketEnd, '2026-01-04T22:00:00.000Z');
  const month = reportBuckets(new Date('2026-01-31T22:00:00Z'), new Date('2026-02-28T22:00:00Z'), 'month');
  assert.equal(month.length, 1); assert.equal(month[0].key, '2026-02-01');
});
test('empty reports retain explicit metrics, arrays, all statuses/methods and null average; service independently enforces scope/range', async () => {
  const service = createReportsService({ auth, products, repository: emptyReportRepository });
  const overview = await service.overview('b2c', staff, reportRange);
  assert.deepEqual(overview.metrics, { ordersPlaced: 0, unitsPlaced: 0, placedOrderAmount: 0, pendingOrders: 0, averagePlacedOrderAmount: null });
  assert.equal(overview.topProducts.length, 0); assert.ok(overview.trend.every(row => row.ordersPlaced === 0));
  const finance = await service.finance('b2c', staff, reportRange);
  assert.equal(finance.byStatus.length, 6); assert.equal(finance.byPaymentMethod.length, 2); assert.equal(finance.collectionMarkers.totalRecordedAmount, 0);
  const performance = await service.performance('b2c', staff, reportRange);
  assert.deepEqual(performance.pagination, { page: 1, limit: 20, total: 0, pages: 0 });
  for (const method of ['overview', 'finance', 'performance']) {
    await assert.rejects(service[method]('b2c', { role: 'moderator' }, reportRange), { code: 'FORBIDDEN' });
    await assert.rejects(service[method]('b2b', staff, reportRange), { code: 'INVALID_STORE' });
    for (const input of [{}, { ...reportRange, to: reportRange.from }, { ...reportRange, to: '2028-01-01T00:00:00Z' }, { ...reportRange, timezone: 'UTC' }])
      await assert.rejects(service[method]('b2c', staff, input), { code: 'VALIDATION_ERROR' });
  }
});
test('report money uses exact half-up averages and fails closed on unsafe sums and timed-out aggregation', async () => {
  const repository = { async aggregate(pipeline) { const [row] = await emptyReportRepository.aggregate(pipeline); row.metrics = [{ ordersPlaced: 2, unitsPlaced: 2, placedOrderAmount: 25, pendingOrders: 0 }]; return [row]; } };
  assert.equal((await createReportsService({ auth, products, repository }).overview('b2c', staff, reportRange)).metrics.averagePlacedOrderAmount, 13);
  repository.aggregate = async () => [{ metrics: [{ placedOrderAmount: Number.MAX_SAFE_INTEGER + 1 }] }];
  await assert.rejects(createReportsService({ auth, products, repository }).overview('b2c', staff, reportRange), { code: 'REPORT_TOTAL_UNAVAILABLE' });
  repository.aggregate = async () => { throw Object.assign(new Error('timeout'), { code: 50 }); };
  await assert.rejects(createReportsService({ auth, products, repository }).finance('b2c', staff, reportRange), { code: 'REPORT_BUSY' });
});
