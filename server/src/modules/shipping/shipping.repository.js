import { ShippingFee, ShippingSettings, ShippingAudit } from './shipping.model.js';

export const shippingRepository = {
  async initialize() {
    await Promise.all([ShippingFee.init(), ShippingSettings.init(), ShippingAudit.init()]);
    await ShippingSettings.updateOne({ _id: 'b2c' }, { $setOnInsert: { defaultFee: 5000 } }, { upsert: true });
  },
  list: (store, { page, limit }) => Promise.all([
    ShippingFee.find({ store }).sort({ governorateCode: 1 }).skip((page - 1) * limit).limit(limit).lean(),
    ShippingFee.countDocuments({ store }),
  ]),
  findById: (store, feeId, session = null) => ShippingFee.findOne({ store, _id: feeId }).session(session).lean(),
  findByCode: (store, governorateCode, session = null) => ShippingFee.findOne({ store, governorateCode }).session(session).lean(),
  getDefault: (store, session = null) => ShippingSettings.findById(store).session(session).lean(),
  setDefault: (store, defaultFee, session) => ShippingSettings.findOneAndUpdate({ _id: store },
    { $set: { defaultFee } }, { upsert: true, returnDocument: 'after', runValidators: true, session }).lean(),
  create: async (data, session) => (await ShippingFee.create([data], { session }))[0].toObject(),
  update: (store, feeId, fields, session) => ShippingFee.findOneAndUpdate({ store, _id: feeId },
    { $set: fields }, { returnDocument: 'after', runValidators: true, session }).lean(),
  remove: (store, feeId, session) => ShippingFee.deleteOne({ store, _id: feeId }, { session }),
  audit: (data, session) => ShippingAudit.create([data], { session }),
};
