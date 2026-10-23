import { FormDefinition, FormAudit } from './forms.model.js';
import { formTypes, initialTitles } from './forms.definitions.js';

export const formsRepository = {
  async initialize() {
    await Promise.all([FormDefinition.init(), FormAudit.init()]);
    await Promise.all(formTypes.map(type => FormDefinition.updateOne({ store: 'b2b', type },
      { $setOnInsert: { title: initialTitles[type], helpText: { ar: '', en: '' }, fields: [], isActive: false, version: 0 } },
      { upsert: true, runValidators: true })));
  },
  list: (store, publicOnly = false) => FormDefinition.find({ store, ...(publicOnly ? { isActive: true } : {}) }).lean(),
  find: (store, type, session = null) => FormDefinition.findOne({ store, type }).session(session).lean(),
  lockForSubmission: (store, type, version, session) => FormDefinition.findOneAndUpdate({ store, type, version, isActive: true },
    { $inc: { submissionRevision: 1 } }, { session, returnDocument: 'after' }).lean(),
  update: (store, type, version, fields, session) => FormDefinition.findOneAndUpdate({ store, type, version },
    { $set: fields, $inc: { version: 1 } }, { returnDocument: 'after', runValidators: true, session }).lean(),
  audit: (data, session) => FormAudit.create([data], { session }),
};
