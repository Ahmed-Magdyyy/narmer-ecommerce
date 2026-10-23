import { SiteSettings, SiteSettingsAudit } from './sitesettings.model.js';

export const sitesettingsRepository = {
  initialize: () => Promise.all([SiteSettings.init(), SiteSettingsAudit.init()]),
  find: (store, session = null) => SiteSettings.findById(store).session(session).lean(),
  create: async (data, session) => (await SiteSettings.create([data], { session }))[0].toObject(),
  update: (store, version, fields, session) => SiteSettings.findOneAndUpdate({ _id: store, version,
    $expr: { $lt: ['$version', Number.MAX_SAFE_INTEGER] } }, { $set: fields, $inc: { version: 1 } },
  { session, returnDocument: 'after', runValidators: true }).lean(),
  audit: (data, session) => SiteSettingsAudit.create([data], { session }),
};
