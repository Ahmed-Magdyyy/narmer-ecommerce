import { Order, Checkout, OrderProof, OrderSettings, OrderAudit } from './orders.model.js';

const cleanupFilter = at => ({ $or: [{ status: 'deletePending' },
  { status: { $in: ['uploading', 'ready'] }, expiresAt: { $lte: at } }] });
export const ordersRepository = {
  initialize: () => Promise.all([Order.init(), Checkout.init(), OrderProof.init(), OrderSettings.init(), OrderAudit.init()]),
  getSettings: (store, session = null) => OrderSettings.findById(store).session(session).lean(),
  setSettings: (store, receivingAccount, session) => OrderSettings.findOneAndUpdate({ _id: store },
    { $set: { receivingAccount } }, { upsert: true, returnDocument: 'after', runValidators: true, session }).lean(),
  audit: (data, session) => OrderAudit.create([data], { session }),
  createCheckout: async (data, session) => (await Checkout.create([data], { session }))[0].toObject(),
  findCheckout: (store, id, ownerKey, session = null) => Checkout.findOne({ store, _id: id, ownerKey }).session(session).lean(),
  create: async (data, session) => (await Order.create([data], { session }))[0].toObject({ flattenMaps: true }),
  findByCheckout: (store, checkoutId, session = null) => Order.findOne({ store, checkoutId }).select('+trackingHash').session(session).lean(),
  findById: (store, id, session = null) => Order.findOne({ store, _id: id }).session(session).lean(),
  findTracking: (store, id) => Order.findOne({ store, _id: id }).select('+trackingHash').lean(),
  list: (store, { page, limit, status, userId }) => {
    const filter = { store, ...(status ? { status } : {}), ...(userId ? { userId } : {}) };
    return Promise.all([Order.find(filter).sort({ createdAt: -1, _id: -1 }).skip((page - 1) * limit).limit(limit).lean(), Order.countDocuments(filter)]);
  },
  updateStatus: (store, id, previousStatus, fields, event, session) => Order.findOneAndUpdate({ store, _id: id, status: previousStatus },
    { $set: fields, $push: { history: event } }, { returnDocument: 'after', runValidators: true, session }).lean(),
  hasProductReferences: (store, productId, variantIds, session) => Order.exists({ store,
    items: { $elemMatch: { productId, ...(variantIds ? { variantId: { $in: variantIds } } : {}) } } }).session(session),
  createProof: async data => (await OrderProof.create(data)).toObject(),
  readyProof: (id, at) => OrderProof.findOneAndUpdate({ _id: id, status: 'uploading', expiresAt: { $gt: at } },
    { $set: { status: 'ready' } }, { returnDocument: 'after' }).lean(),
  findProof: (store, id, session = null) => OrderProof.findOne({ store, _id: id }).session(session).lean(),
  attachProof: (store, id, checkoutId, ownerKey, orderId, at, session) => OrderProof.findOneAndUpdate({ store, _id: id, checkoutId, ownerKey,
    status: 'ready', expiresAt: { $gt: at } }, { $set: { status: 'attached', orderId } }, { returnDocument: 'after', session }).lean(),
  cleanupCandidates: at => OrderProof.find(cleanupFilter(at)).sort({ updatedAt: 1 }).limit(50).lean(),
  claimCleanup: (id, at) => OrderProof.findOneAndUpdate({ _id: id, ...cleanupFilter(at) },
    { $set: { status: 'deletePending' } }, { returnDocument: 'after' }).lean(),
  completeCleanup: id => OrderProof.deleteOne({ _id: id, status: 'deletePending' }),
};
