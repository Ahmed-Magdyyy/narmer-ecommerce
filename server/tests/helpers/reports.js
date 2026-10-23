export const reportRange = { from: '2026-01-01T00:00:00.000Z', to: '2026-02-01T00:00:00.000Z' };
export const emptyReportRepository = { async aggregate(pipeline) {
  return [Object.fromEntries(Object.keys(pipeline.at(-1).$facet).map(key => [key, []]))];
} };
export function reportOrder(number = 1, changes = {}) {
  const id = number.toString(16).padStart(24, '0'), date = new Date('2026-01-10T10:00:00.000Z');
  const item = { productId: 'a'.repeat(24), variantId: null, name: { en: 'Historical shirt', ar: 'قميص قديم' }, slug: 'historical-shirt',
    category: { id: 'b'.repeat(24), name: { en: 'Historical category', ar: 'التصنيف القديم' } },
    values: null, sku: null, quantity: 2, price: 6000, discountedPrice: 5000, unitPrice: 5000,
    lineTotal: 10000, couponDiscount: 1000, lineTotalAfterDiscount: 9000, activeSale: null };
  const shipping = { id: null, governorateCode: 'cairo', name: null, fee: 5000, currency: 'EGP', source: 'default' };
  return { _id: id, store: 'b2c', ownerKey: `u:${id}`, userId: id, checkoutId: id, requestDigest: 'test', trackingHash: 'test',
    trackingExpiresAt: new Date('2027-01-01T00:00:00Z'), status: 'delivered', notificationLocale: 'en',
    customer: { name: 'Test buyer', email: 'buyer@example.test', phone: '201001234567' },
    address: { governorateCode: 'cairo', governorate: 'Cairo', district: 'Test district', building: '1', street: 'Test street', floor: '', apartment: '', details: '' },
    items: [item], totals: { subtotal: 10000, discountAmount: 1000, shippingFee: 5000, total: 14000 }, shipping, coupon: null,
    quotedPreview: { items: [item], shipping, coupon: null, totals: { subtotal: 10000, discountAmount: 1000, shippingFee: 5000, total: 14000 },
      currency: 'EGP', quotedAt: date.toISOString(), receivingAccount: null },
    payment: { method: 'cod', proofId: null, receivingAccount: null, verifiedAt: null, verifiedBy: null, cashCollectedAt: date, cashCollectedBy: id },
    refund: null, stockRestored: false, history: [{ status: 'pending', at: date, actorId: null }, { status: 'delivered', at: date, actorId: id }],
    createdAt: date, updatedAt: date, ...changes };
}
