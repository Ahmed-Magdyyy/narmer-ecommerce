import mongoose from 'mongoose';

export const orderStatuses = ['pending', 'accepted', 'shipped', 'delivered', 'canceled', 'returned'];
const options = { _id: false, strict: 'throw' };
const money = { type: Number, required: true, min: 0, max: 1000001000000000, validate: Number.isSafeInteger };
const names = new mongoose.Schema({ ar: { type: String, required: true }, en: { type: String, required: true } }, options);
const item = new mongoose.Schema({
  productId: { type: mongoose.Schema.Types.ObjectId, required: true },
  category: { type: new mongoose.Schema({ id: { type: mongoose.Schema.Types.ObjectId, required: true }, name: { type: names, required: true } }, options), default: null },
  variantId: { type: mongoose.Schema.Types.ObjectId, default: null },
  name: { type: names, required: true }, slug: { type: String, required: true },
  values: { type: Map, of: String, default: null }, sku: { type: String, default: null },
  quantity: { type: Number, required: true, min: 1, max: 10000, validate: Number.isSafeInteger },
  price: money, discountedPrice: { ...money, required: false, default: null,validate:value=>value===null||Number.isSafeInteger(value) },
  unitPrice: money, lineTotal: money, couponDiscount: money, lineTotalAfterDiscount: money,
  activeSale: { type: mongoose.Schema.Types.Mixed, default: null },
}, options);
const customer = new mongoose.Schema({
  name: { type: String, required: true, maxlength: 100 }, email: { type: String, required: true, maxlength: 254 },
  phone: { type: String, required: true },
}, options);
const address = new mongoose.Schema({
  governorateCode: { type: String, required: true }, governorate: { type: String, required: true, maxlength: 100 },
  district: { type: String, required: true, maxlength: 100 }, building: { type: String, required: true, maxlength: 200 },
  street: { type: String, required: true, maxlength: 200 }, floor: { type: String, default: '', maxlength: 50 },
  apartment: { type: String, default: '', maxlength: 50 }, details: { type: String, default: '', maxlength: 1000 },
}, options);
const totals = new mongoose.Schema({ subtotal: money, discountAmount: money, shippingFee: money, total: money }, options);
const payment = new mongoose.Schema({
  method: { type: String, required: true, enum: ['cod', 'instapay'] },
  proofId: { type: mongoose.Schema.Types.ObjectId, default: null }, receivingAccount: { type: String, default: null },
  verifiedAt: { type: Date, default: null }, verifiedBy: { type: mongoose.Schema.Types.ObjectId, default: null },
  cashCollectedAt: { type: Date, default: null }, cashCollectedBy: { type: mongoose.Schema.Types.ObjectId, default: null },
}, options);
const event = new mongoose.Schema({
  status: { type: String, enum: orderStatuses, required: true }, at: { type: Date, required: true },
  actorId: { type: mongoose.Schema.Types.ObjectId, default: null },
  actor: { type: new mongoose.Schema({
    name: { type: String, required: true, maxlength: 100 },
    role: { type: String, required: true, enum: ['superAdmin', 'admin', 'moderator'] },
  }, options), default: null },
}, options);
const order = new mongoose.Schema({
  orderNumber: { type: String, required: true, immutable: true, match: /^NRM-\d{8}-[A-Z0-9]{6}$/ },
  notificationLocale: { type: String, enum: ['ar', 'en'], default: 'en' },
  store: { type: String, enum: ['b2c'], required: true, immutable: true },
  ownerKey: { type: String, required: true, immutable: true }, userId: { type: mongoose.Schema.Types.ObjectId, default: null, immutable: true },
  checkoutId: { type: mongoose.Schema.Types.ObjectId, required: true, immutable: true },
  requestDigest: { type: String, required: true, immutable: true },
  trackingHash: { type: String, required: true, select: false }, trackingExpiresAt: { type: Date, required: true },
  status: { type: String, enum: orderStatuses, required: true, default: 'pending' },
  customer: { type: customer, required: true }, address: { type: address, required: true },
  items: { type: [item], required: true }, totals: { type: totals, required: true },
  shipping: { type: mongoose.Schema.Types.Mixed, required: true }, coupon: { type: mongoose.Schema.Types.Mixed, default: null },
  quotedPreview: { type: mongoose.Schema.Types.Mixed, required: true },
  payment: { type: payment, required: true },
  refund: { type: new mongoose.Schema({ amount: money, at: { type: Date, required: true },
    actorId: { type: mongoose.Schema.Types.ObjectId, required: true } }, options), default: null },
  stockRestored: { type: Boolean, default: false, required: true }, history: { type: [event], required: true },
}, { timestamps: true, strict: 'throw' });
order.index({ store: 1, checkoutId: 1 }, { unique: true });
order.index({ orderNumber: 1 }, { unique: true, partialFilterExpression: { orderNumber: { $type: 'string' } } });
order.index({ store: 1, userId: 1, createdAt: -1, _id: -1 });
order.index({ store: 1, status: 1, createdAt: -1, _id: -1 });
order.index({ store: 1, 'items.productId': 1 });
order.index({ store: 1, createdAt: -1, _id: -1 });
order.index({ store: 1, 'payment.verifiedAt': 1 });
order.index({ store: 1, 'payment.cashCollectedAt': 1 });
order.index({ store: 1, 'refund.at': 1 });
export const Order = mongoose.model('Order', order);

const checkout = new mongoose.Schema({
  store: { type: String, enum: ['b2c'], required: true, immutable: true },
  ownerKey: { type: String, required: true, immutable: true }, userId: { type: mongoose.Schema.Types.ObjectId, default: null },
  input: { type: mongoose.Schema.Types.Mixed, required: true }, preview: { type: mongoose.Schema.Types.Mixed, required: true },
  selections: { type: String, required: true }, expiresAt: { type: Date, required: true },
}, { timestamps: true, strict: 'throw' });
checkout.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
export const Checkout = mongoose.model('Checkout', checkout);

const proof = new mongoose.Schema({
  store: { type: String, enum: ['b2c'], required: true, immutable: true },
  checkoutId: { type: mongoose.Schema.Types.ObjectId, required: true, immutable: true }, ownerKey: { type: String, required: true, immutable: true },
  objectKey: { type: String, required: true, immutable: true }, zone: { type: String, required: true, immutable: true },
  endpoint: { type: String, required: true, immutable: true }, width: { type: Number, required: true }, height: { type: Number, required: true },
  status: { type: String, enum: ['uploading', 'ready', 'attached', 'deletePending'], required: true },
  orderId: { type: mongoose.Schema.Types.ObjectId, default: null }, expiresAt: { type: Date, required: true },
}, { timestamps: true, strict: 'throw' });
proof.index({ objectKey: 1 }, { unique: true });
proof.index({ status: 1, expiresAt: 1 });
export const OrderProof = mongoose.model('OrderProof', proof);

export const OrderSettings = mongoose.model('OrderSettings', new mongoose.Schema({
  _id: { type: String, enum: ['b2c'], required: true },
  receivingAccount: { type: String, default: null, maxlength: 200 },
}, { timestamps: true, strict: 'throw' }));
export const OrderAudit = mongoose.model('OrderAudit', new mongoose.Schema({
  store: { type: String, enum: ['b2c'], required: true }, actorId: { type: mongoose.Schema.Types.ObjectId, required: true },
  action: { type: String, enum: ['settings.updated'], required: true },
}, { timestamps: true, strict: 'throw' }));
