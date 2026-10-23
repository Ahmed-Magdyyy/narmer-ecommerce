import { SizeChart, SizeChartAudit } from './sizecharts.model.js';

export const sizechartsRepository = {
  initialize: () => Promise.all([SizeChart.init(), SizeChartAudit.init()]),
  findById: (store, id, session = null) => SizeChart.findOne({ store, _id: id }).session(session).lean(),
  publicByIds: (store, ids) => SizeChart.find({ store, _id: { $in: ids }, isActive: true }).lean(),
  list: (store, { page, limit, isActive }) => {
    const filter = { store, ...(isActive === undefined ? {} : { isActive }) };
    return Promise.all([SizeChart.find(filter).sort({ createdAt: -1, _id: -1 }).skip((page - 1) * limit).limit(limit).lean(),
      SizeChart.countDocuments(filter)]);
  },
  create: async (data, session) => (await SizeChart.create([data], { session }))[0].toObject(),
  update: (store, id, version, fields, session) => SizeChart.findOneAndUpdate({ store, _id: id, version,
    $expr: { $lt: ['$version', Number.MAX_SAFE_INTEGER] } }, { $set: fields, $inc: { version: 1 } },
  { session, returnDocument: 'after', runValidators: true }).lean(),
  remove: (store, id, session) => SizeChart.deleteOne({ store, _id: id }, { session }),
  audit: (data, session) => SizeChartAudit.create([data], { session }),
};
