import { Lead, LeadDraft, LeadImage, LeadAudit } from './leads.model.js';

const cleanup = at => ({ $or: [{ status: 'deletePending' },
  { status: { $in: ['uploading', 'ready', 'failed'] }, expiresAt: { $lte: at } }] });
export const leadsRepository = {
  initialize: () => Promise.all([Lead.init(), LeadDraft.init(), LeadImage.init(), LeadAudit.init()]),
  createDraft: async data => (await LeadDraft.create(data)).toObject(),
  findDraft: (store, id, session = null) => LeadDraft.findOne({ store, _id: id }).select('+tokenHash').session(session).lean(),
  touchDraft: (store, id, at, session) => LeadDraft.findOneAndUpdate({ store, _id: id, status: 'open', expiresAt: { $gt: at } },
    { $inc: { revision: 1 } }, { returnDocument: 'after', session }).select('+tokenHash').lean(),
  reserveImage: (store, id, at, session) => LeadDraft.findOneAndUpdate({ store, _id: id, status: 'open', expiresAt: { $gt: at }, imageSlots: { $lt: 5 } },
    { $inc: { revision: 1, imageSlots: 1 } }, { returnDocument: 'after', session }).lean(),
  releaseImage: (store, id, session) => LeadDraft.updateOne({ store, _id: id, imageSlots: { $gt: 0 } }, { $inc: { imageSlots: -1 } }, { session }),
  finishDraft: (store, id, at, session) => LeadDraft.updateOne({ store, _id: id, status: 'open', expiresAt: { $gt: at } },
    { $set: { status: 'submitted' }, $inc: { revision: 1 } }, { session }),
  createImage: async (data, session) => (await LeadImage.create([data], { session }))[0].toObject(),
  findImage: (store, id, session = null) => LeadImage.findOne({ store, _id: id }).session(session).lean(),
  draftImages: (store, draftId, session = null) => LeadImage.find({ store, draftId, status: { $in: ['uploading', 'ready'] } }).sort({ createdAt: 1, _id: 1 }).session(session).lean(),
  setImageStatus: (store, id, previous, status, session, extra = {}) => LeadImage.findOneAndUpdate({ store, _id: id, status: previous },
    { $set: { status, ...extra } }, { returnDocument: 'after', session }).lean(),
  retireUnused: (store, draftId, session) => LeadImage.updateMany({ store, draftId, status: 'ready' }, { $set: { status: 'deletePending' } }, { session }),
  create: async (data, session) => (await Lead.create([data], { session }))[0].toObject(),
  findByDraft: (store, draftId, session) => Lead.findOne({ store, draftId }).select('+draftTokenHash +requestHash +trackingHash').session(session).lean(),
  find: (store, id, session = null) => Lead.findOne({ store, _id: id }).session(session).lean(),
  findTracking: (store, id) => Lead.findOne({ store, _id: id }).select('+trackingHash').lean(),
  findForEmail: id => Lead.findOne({ store: 'b2b', _id: id }).select('+trackingHash +draftTokenHash').lean(),
  list: (store, input) => {
    const filter = { store, ...(input.userId ? { userId: input.userId } : {}), ...(input.formType ? { formType: input.formType } : {}),
      ...(input.status ? { status: input.status } : {}) };
    return Promise.all([Lead.find(filter).sort({ createdAt: -1, _id: -1 }).skip((input.page - 1) * input.limit).limit(input.limit).lean(), Lead.countDocuments(filter)]);
  },
  contacted: (store, id, actorId, at, session) => Lead.findOneAndUpdate({ store, _id: id, status: 'submitted' },
    { $set: { status: 'contacted', contactedAt: at, contactedBy: actorId } }, { session, returnDocument: 'after' }).lean(),
  audit: (data, session) => LeadAudit.create([data], { session }),
  hasOfferReferences: (offerId, session) => Lead.exists({ store: 'b2b', 'wholesaleRequests.id': offerId }).session(session),
  cleanupCandidates: at => LeadImage.find(cleanup(at)).sort({ updatedAt: 1, _id: 1 }).limit(50).lean(),
  claimCleanup: (id, at) => LeadImage.findOneAndUpdate({ _id: id, ...cleanup(at) }, { $set: { status: 'deletePending' } }, { returnDocument: 'after' }).lean(),
  completeCleanup: id => LeadImage.deleteOne({ _id: id, status: 'deletePending' }),
};
