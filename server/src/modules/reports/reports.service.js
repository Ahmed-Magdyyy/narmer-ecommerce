import { AppError } from '../../shared/errors/app-error.js';
import { orderView } from '../orders/orders.service.js';
import { orderStatuses } from './reports.model.js';
import { reportsRepository } from './reports.repository.js';

const timezone = 'Africa/Cairo';
const calendar = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' });
const dayKey = value => calendar.format(value);
const midnightUtc = key => new Date(`${key}T00:00:00.000Z`);
const keyUtc = date => date.toISOString().slice(0, 10);
const invalid = () => { throw new AppError(422, 'VALIDATION_ERROR'); };
const local = (name, locale) => name?.[locale] || name?.[locale === 'ar' ? 'en' : 'ar'] || '';

// Find the first instant of a Cairo date, including a DST midnight that jumps to 01:00.
function cairoBoundary(key) {
  const anchor = midnightUtc(key).getTime(); let low = anchor - 36 * 3600000, high = anchor + 36 * 3600000;
  while (low < high) { const mid = Math.floor((low + high) / 2); if (dayKey(new Date(mid)) < key) low = mid + 1; else high = mid; }
  return new Date(low).toISOString();
}
export function reportBuckets(from, to, interval) {
  const cursor = midnightUtc(dayKey(from));
  if (interval === 'week') cursor.setUTCDate(cursor.getUTCDate() - (cursor.getUTCDay() + 6) % 7);
  if (interval === 'month') cursor.setUTCDate(1);
  const result = [];
  for (;;) {
    const key = keyUtc(cursor), bucketStart = cairoBoundary(key);
    if (Date.parse(bucketStart) >= to.getTime()) break;
    if (interval === 'month') cursor.setUTCMonth(cursor.getUTCMonth() + 1);
    else cursor.setUTCDate(cursor.getUTCDate() + (interval === 'week' ? 7 : 1));
    result.push({ key, bucketStart, bucketEnd: cairoBoundary(keyUtc(cursor)) });
  }
  return result;
}
function bounds(input) {
  if (typeof input.from !== 'string' || typeof input.to !== 'string') invalid();
  const from = new Date(input.from), to = new Date(input.to), interval = input.interval ?? 'day';
  if (!Number.isFinite(+from) || !Number.isFinite(+to) || from >= to || +to - +from > 366 * 86400000
    || from.getUTCFullYear() < 2000 || to.getUTCFullYear() > 2100
    || !['day', 'week', 'month'].includes(interval) || (input.timezone !== undefined && input.timezone !== timezone)) invalid();
  return { from, to, interval };
}
const inRange = (field, range) => ({ [field]: { $gte: range.from, $lt: range.to } });
const match = filter => ({ $match: filter });
const sum = field => ({ $sum: field });
const grouped = (fields, by = null) => ({ $group: { _id: by, ...Object.fromEntries(Object.entries(fields).map(([key, field]) => [key, sum(field)])) } });
function bucket(field, interval) {
  return { $dateToString: { format: '%Y-%m-%d', timezone, date: { $dateTrunc: { date: field, unit: interval, timezone, ...(interval === 'week' ? { startOfWeek: 'monday' } : {}) } } } };
}
const productGroup = {
  $group: { _id: '$items.productId', name: { $first: '$items.name' }, quantity: sum('$items.quantity'),
    orders: { $addToSet: '$_id' }, merchandiseAmount: sum('$items.lineTotalAfterDiscount') },
};
const productProject = { $project: { _id: 0, productId: { $toString: '$_id' }, name: 1, quantity: 1, merchandiseAmount: 1, orderCount: { $size: '$orders' } } };
function ranking(rankBy) {
  return [match({ status: 'delivered' }), { $sort: { createdAt: -1, _id: -1 } }, { $unwind: '$items' }, productGroup, productProject,
    { $sort: { [rankBy === 'units' ? 'quantity' : 'merchandiseAmount']: -1, productId: 1 } }];
}
function safeNumbers(value) {
  if (typeof value === 'number' && (!Number.isSafeInteger(value) || value < 0)) throw new AppError(503, 'REPORT_TOTAL_UNAVAILABLE');
  if (Array.isArray(value)) value.forEach(safeNumbers);
  else if (value && typeof value === 'object' && !(value instanceof Date)) for (const [key, child] of Object.entries(value)) if (key !== '_id') safeNumbers(child);
  return value;
}
const withoutId = row => Object.fromEntries(Object.entries(row ?? {}).filter(([key]) => key !== '_id'));
const fill = (buckets, rows, fields) => {
  const byKey = new Map(rows.map(row => [row._id, withoutId(row)]));
  return buckets.map(({ key, ...dates }) => ({ ...dates, ...Object.fromEntries(fields.map(field => [field, byKey.get(key)?.[field] ?? 0])) }));
};

export function createReportsService({ auth, products, repository = reportsRepository, now = () => new Date() }) {
  async function context(store, identity, input) {
    if (store !== 'b2c') throw new AppError(400, 'INVALID_STORE');
    await auth.authorizeStaff(store, identity, ['superAdmin', 'admin']);
    return { ...bounds(input), generatedAt: now().toISOString() };
  }
  const meta = range => ({ from: range.from.toISOString(), to: range.to.toISOString(), timezone, interval: range.interval,
    currency: 'EGP', generatedAt: range.generatedAt, definitionsVersion: 'v1',
    limitations: ['offline-payment-refund-markers-only', 'current-order-status', 'legacy-category-unknown', 'direct-category-snapshots-only'] });
  async function productRows(rows, locale) {
    const details = new Map((await products.getReportMetadata(rows.map(row => row.productId))).map(row => [row.id, row]));
    return rows.map(row => ({ productId: row.productId, name: local(row.name, locale), slug: details.get(row.productId)?.slug ?? null,
      image: details.get(row.productId)?.image ?? null, quantity: row.quantity, orderCount: row.orderCount, merchandiseAmount: row.merchandiseAmount }));
  }
  async function aggregate(pipeline) {
    try { return safeNumbers((await repository.aggregate(pipeline))[0]); }
    catch (error) { if (error.code === 50) throw new AppError(503, 'REPORT_BUSY'); throw error; }
  }
  return {
    async overview(store, identity, input = {}, locale = 'en') {
      const range = await context(store, identity, input), cohort = inRange('createdAt', range);
      const fields = { ordersPlaced: 1, unitsPlaced: { $sum: '$items.quantity' }, placedOrderAmount: '$totals.total',
        pendingOrders: { $cond: [{ $eq: ['$status', 'pending'] }, 1, 0] } };
      const data = await aggregate([match({ store, ...cohort }), { $facet: {
        metrics: [grouped(fields)], trend: [grouped({ ordersPlaced: 1, unitsPlaced: { $sum: '$items.quantity' }, placedOrderAmount: '$totals.total' }, bucket('$createdAt', range.interval))],
        topProducts: [...ranking('units'), { $limit: 5 }], recentOrders: [{ $sort: { createdAt: -1, _id: -1 } }, { $limit: 5 }],
      } }]);
      const metrics = { ordersPlaced: 0, unitsPlaced: 0, placedOrderAmount: 0, pendingOrders: 0, ...withoutId(data.metrics[0]) };
      metrics.averagePlacedOrderAmount = metrics.ordersPlaced ? Number((2n * BigInt(metrics.placedOrderAmount) + BigInt(metrics.ordersPlaced)) / (2n * BigInt(metrics.ordersPlaced))) : null;
      return { meta: meta(range), metrics, trend: fill(reportBuckets(range.from, range.to, range.interval), data.trend, ['ordersPlaced', 'unitsPlaced', 'placedOrderAmount']),
        topProducts: await productRows(data.topProducts, locale), recentOrders: data.recentOrders.map(row => orderView(row, locale, true)) };
    },
    async finance(store, identity, input = {}) {
      const range = await context(store, identity, input), cohort = inRange('createdAt', range);
      const markers = [inRange('payment.verifiedAt', range), inRange('payment.cashCollectedAt', range), inRange('refund.at', range)];
      const amounts = { subtotal: '$totals.subtotal', couponDiscountAmount: '$totals.discountAmount', shippingFee: '$totals.shippingFee', total: '$totals.total' };
      const data = await aggregate([match({ store, $or: [cohort, ...markers] }), { $facet: {
        orderAmounts: [match(cohort), grouped(amounts)],
        byStatus: [match(cohort), grouped({ count: 1, orderAmount: '$totals.total' }, '$status')],
        byPaymentMethod: [match(cohort), grouped({ orderCount: 1, orderAmount: '$totals.total' }, '$payment.method')],
        placedTrend: [match(cohort), grouped({ placedOrderAmount: '$totals.total' }, bucket('$createdAt', range.interval))],
        instapay: [match({ ...markers[0], 'payment.method': 'instapay' }), grouped({ amount: '$totals.total' })],
        cod: [match({ ...markers[1], 'payment.method': 'cod' }), grouped({ amount: '$totals.total' })],
        refunds: [match(markers[2]), grouped({ amount: '$refund.amount', orderCount: 1 })],
        instapayTrend: [match({ ...markers[0], 'payment.method': 'instapay' }), grouped({ instapayVerifiedAmount: '$totals.total' }, bucket('$payment.verifiedAt', range.interval))],
        codTrend: [match({ ...markers[1], 'payment.method': 'cod' }), grouped({ codCollectedAmount: '$totals.total' }, bucket('$payment.cashCollectedAt', range.interval))],
        refundTrend: [match(markers[2]), grouped({ refundMarkerAmount: '$refund.amount' }, bucket('$refund.at', range.interval))],
      } }]);
      const instapayVerifiedAmount = data.instapay[0]?.amount ?? 0, codCollectedAmount = data.cod[0]?.amount ?? 0;
      const collectionMarkers = safeNumbers({ instapayVerifiedAmount, codCollectedAmount, totalRecordedAmount: instapayVerifiedAmount + codCollectedAmount });
      const buckets = reportBuckets(range.from, range.to, range.interval), trends = [data.placedTrend, data.instapayTrend, data.codTrend, data.refundTrend];
      const combined = new Map();
      for (const rows of trends) for (const row of rows) combined.set(row._id, { ...combined.get(row._id), ...row });
      return { meta: meta(range), orderAmounts: { subtotal: 0, couponDiscountAmount: 0, shippingFee: 0, total: 0, ...withoutId(data.orderAmounts[0]) },
        collectionMarkers, refundMarkers: { amount: 0, orderCount: 0, ...withoutId(data.refunds[0]) },
        byStatus: orderStatuses.map(status => ({ status, count: data.byStatus.find(row => row._id === status)?.count ?? 0, orderAmount: data.byStatus.find(row => row._id === status)?.orderAmount ?? 0 })),
        byPaymentMethod: ['cod', 'instapay'].map(method => ({ method, orderCount: data.byPaymentMethod.find(row => row._id === method)?.orderCount ?? 0,
          orderAmount: data.byPaymentMethod.find(row => row._id === method)?.orderAmount ?? 0, recordedCollectionAmount: method === 'cod' ? codCollectedAmount : instapayVerifiedAmount })),
        trend: fill(buckets, [...combined.values()], ['placedOrderAmount', 'instapayVerifiedAmount', 'codCollectedAmount', 'refundMarkerAmount']) };
    },
    async performance(store, identity, input = {}, locale = 'en') {
      const range = await context(store, identity, input), page = input.page ?? 1, limit = input.limit ?? 20, rankBy = input.rankBy ?? 'units';
      if (!Number.isSafeInteger(page) || page < 1 || page > 100000 || !Number.isSafeInteger(limit) || limit < 1 || limit > 100 || !['units', 'merchandiseAmount'].includes(rankBy)) invalid();
      const data = await aggregate([match({ store, ...inRange('createdAt', range), status: 'delivered' }), { $facet: {
        items: [...ranking(rankBy), { $skip: (page - 1) * limit }, { $limit: limit }],
        total: [{ $unwind: '$items' }, { $group: { _id: '$items.productId' } }, { $count: 'count' }],
        categories: [{ $sort: { createdAt: -1, _id: -1 } }, { $unwind: '$items' }, { $group: {
          _id: { $ifNull: ['$items.category.id', null] }, name: { $first: '$items.category.name' }, quantity: sum('$items.quantity'), merchandiseAmount: sum('$items.lineTotalAfterDiscount'),
        } }, { $sort: { [rankBy === 'units' ? 'quantity' : 'merchandiseAmount']: -1, _id: 1 } }],
      } }]);
      const total = data.total[0]?.count ?? 0;
      return { meta: meta(range), rankingBasis: { dateField: 'createdAt', includedStatuses: ['delivered'], rankBy },
        items: await productRows(data.items, locale), pagination: { page, limit, total, pages: Math.ceil(total / limit) },
        categories: data.categories.map(row => ({ categoryId: row._id ? String(row._id) : null, name: row._id ? local(row.name, locale) : null,
          quantity: row.quantity, merchandiseAmount: row.merchandiseAmount })) };
    },
  };
}
