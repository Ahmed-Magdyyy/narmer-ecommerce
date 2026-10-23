import { randomBytes, createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { AppError } from '../../shared/errors/app-error.js';
import { runTransaction } from '../../shared/utils/transaction.js';
import { normalizePhone, validPhone } from '../../shared/utils/phone.js';
import { processCatalogImage } from '../../shared/infrastructure/media/image.js';
import { leadsRepository } from './leads.repository.js';

const day = 86400000, hash = value => createHash('sha256').update(value).digest('hex');
const invalid = () => { throw new AppError(422, 'INVALID_LEAD'); };
const id = value => { if (typeof value !== 'string' || !/^[a-f0-9]{24}$/i.test(value)) invalid(); return value.toLowerCase(); };
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const equalToken = (digest, token) => typeof digest === 'string' && /^[a-f0-9]{64}$/.test(digest)
  && typeof token === 'string' && /^[A-Za-z0-9_-]{43}$/.test(token)
  && timingSafeEqual(Buffer.from(digest, 'hex'), Buffer.from(hash(token), 'hex'));
const canonical = value => Array.isArray(value) ? value.map(canonical) : object(value)
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
const local = (value, locale) => locale ? (value[locale] || value[locale === 'ar' ? 'en' : 'ar']) : value;
const iso = value => value ? new Date(value).toISOString() : null;
const imageView = image => ({ id: String(image._id), width: image.width, height: image.height });
function contact(input) {
  if (!object(input) || Object.keys(input).some(key => !['name', 'phone', 'email', 'governorate', 'district'].includes(key))) invalid();
  const result = {};
  for (const [key, max] of [['name', 100], ['governorate', 150], ['district', 150]]) {
    if (typeof input[key] !== 'string' || !input[key].trim() || input[key].trim().length > max) invalid();
    result[key] = input[key].trim();
  }
  if (typeof input.phone !== 'string' || input.phone.length > 32) invalid();
  result.phone = normalizePhone(input.phone.trim()); if (!validPhone(result.phone)) invalid();
  if (input.email != null && input.email !== '' && (typeof input.email !== 'string' || input.email.trim().length > 254)) invalid();
  result.email = input.email == null || input.email.trim() === '' ? null : input.email.trim().toLowerCase();
  return result;
}
function answers(input, form) {
  input ??= {};
  if (!object(input) || Object.keys(input).some(key => !form.fields.some(field => field.key === key))) invalid();
  const result = {};
  for (const field of form.fields) {
    let value = input[field.key];
    if (['text', 'textarea'].includes(field.type) && typeof value === 'string') value = value.trim();
    const missing = value == null || (['text', 'textarea', 'select'].includes(field.type) && value === '')
      || (field.type === 'multiselect' && Array.isArray(value) && !value.length);
    if (missing) { if (field.required) invalid(); continue; }
    const choices = (field.choices ?? []).map(choice => choice.key);
    if (['text', 'textarea'].includes(field.type) && (typeof value !== 'string' || value.length > field.constraints.maxLength)) invalid();
    if (field.type === 'number' && (typeof value !== 'number' || !Number.isFinite(value) || value < field.constraints.min || value > field.constraints.max)) invalid();
    if (field.type === 'boolean' && typeof value !== 'boolean') invalid();
    if (field.type === 'select' && (typeof value !== 'string' || !choices.includes(value))) invalid();
    if (field.type === 'multiselect' && (!Array.isArray(value) || value.length > 50 || new Set(value).size !== value.length || value.some(key => typeof key !== 'string' || !choices.includes(key)))) invalid();
    if (!['text', 'textarea', 'number', 'boolean', 'select', 'multiselect'].includes(field.type)) invalid();
    result[field.key] = value;
  }
  return result;
}
function request(input, form) {
  const wholesaleRequests = input.wholesaleRequests ?? [];
  if (!Array.isArray(wholesaleRequests) || wholesaleRequests.length > 10
    || (form.type === 'wholesale' ? !wholesaleRequests.length : wholesaleRequests.length > 0)) invalid();
  const seen = new Set();
  const selections = wholesaleRequests.map(row => {
    if (!object(row) || Object.keys(row).some(key => !['offerId', 'version', 'quantity'].includes(key))) invalid();
    const offerId = id(row.offerId);
    if (seen.has(offerId) || !Number.isSafeInteger(row.version) || row.version < 0 || !Number.isSafeInteger(row.quantity) || row.quantity < 1 || row.quantity > 10000) invalid();
    seen.add(offerId); return { offerId, version: row.version, quantity: row.quantity };
  });
  if (!Array.isArray(input.imageIds ?? [])) invalid();
  const imageIds = (input.imageIds ?? []).map(id);
  if (imageIds.length > 5 || new Set(imageIds).size !== imageIds.length) invalid();
  if (!Number.isSafeInteger(input.formVersion) || input.formVersion < 0) invalid();
  return { draftId: id(input.draftId), formVersion: input.formVersion, contact: contact(input.contact),
    answers: answers(input.answers, form), wholesaleRequests: selections, imageIds };
}
function formView(form, locale) {
  const field = row => ({ ...row, label: local(row.label, locale), choices: row.choices.map(choice => ({ ...choice, label: local(choice.label, locale) })) });
  return { ...form, title: local(form.title, locale), helpText: local(form.helpText, locale), fixedFields: form.fixedFields.map(field), fields: form.fields.map(field) };
}
function leadView(row, locale, staff = false) {
  const product = p => p ? { ...p, name: local(p.name, locale), description: local(p.description, locale),
    options: p.options.map(option => ({ ...option, name: local(option.name, locale), values: option.values.map(value => ({ ...value, name: local(value.name, locale) })) })) } : null;
  return { id: String(row._id), formType: row.formType, status: row.status, contact: row.contact,
    form: formView(row.formSnapshot, locale), answers: row.answers,
    wholesaleRequests: row.wholesaleRequests.map(offer => ({ ...offer, name: local(offer.name, locale), description: local(offer.description, locale), product: product(offer.product) })),
    imageCount: row.imageIds.length, createdAt: iso(row.createdAt), contactedAt: iso(row.contactedAt),
    ...(staff ? { userId: row.userId ? String(row.userId) : null, contactedBy: row.contactedBy ? String(row.contactedBy) : null, imageIds: row.imageIds.map(String) } : {}) };
}
export function createLeadsService({ auth, forms, wholesale, storage, trackingSecret,
  repository = leadsRepository, transaction = runTransaction, now = () => new Date(), logger = { error() {} }, notifications = null } = {}) {
  const checkStore = store => { if (store !== 'b2b') throw new AppError(400, 'INVALID_STORE'); };
  async function customer(store, identity, session = null) {
    checkStore(store); if (!identity) return null;
    return String((await auth.authorizeStaff(store, identity, ['user'], session))._id);
  }
  const staff = (store, identity, session = null) => auth.authorizeStaff(store, identity, ['superAdmin', 'admin', 'moderator'], session);
  async function draft(store, draftId, token, session = null) {
    checkStore(store);
    const row = await repository.findDraft(store, id(draftId), session);
    if (!row || !equalToken(row.tokenHash, token) || row.status !== 'open' || new Date(row.expiresAt) <= now()) throw new AppError(409, 'LEAD_DRAFT_UNAVAILABLE');
    return row;
  }
  const tokenFor = row => createHmac('sha256', trackingSecret).update(`narmer-lead:${row._id}:${row.draftId}:${row.draftTokenHash}`).digest('base64url');
  const receipt = (row, created, locale) => {
    const candidate = row.userId ? null : tokenFor(row);
    return { created, lead: leadView(row, locale), trackingToken: candidate && equalToken(row.trackingHash, candidate) ? candidate : null,
      trackingExpiresAt: row.userId ? null : iso(row.trackingExpiresAt) };
  };
  return {
    async prepare(store, identity, formType) {
      await customer(store, identity); await forms.getPublic(store, formType);
      const token = randomBytes(32).toString('base64url');
      const row = await repository.createDraft({ store, formType, tokenHash: hash(token), status: 'open', imageSlots: 0, revision: 0, expiresAt: new Date(now().getTime() + day) });
      return { draftId: String(row._id), draftToken: token, formType, expiresAt: iso(row.expiresAt) };
    },
    async getDraft(store, identity, draftId, token) {
      await customer(store, identity); const row = await draft(store, draftId, token);
      const images = await repository.draftImages(store, String(row._id));
      return { draftId: String(row._id), formType: row.formType, expiresAt: iso(row.expiresAt),
        images: images.filter(image => image.status === 'ready').map(imageView), uploadingCount: images.filter(image => image.status === 'uploading').length };
    },
    async upload(store, identity, draftId, token, buffer, contentType) {
      await customer(store, identity); await draft(store, draftId, token); storage.assertReady();
      const processed = await processCatalogImage(buffer, contentType), imageId = randomBytes(12).toString('hex');
      const timestamp = now(), objectKey = `narmer/b2b/lead-images/${imageId}.webp`;
      await transaction(async session => {
        await draft(store, draftId, token, session);
        if (!await repository.reserveImage(store, draftId, timestamp, session)) throw new AppError(409, 'LEAD_IMAGE_LIMIT');
        await repository.createImage({ _id: imageId, store, draftId, objectKey, ...storage.scope(), width: processed.width, height: processed.height,
          status: 'uploading', expiresAt: new Date(timestamp.getTime() + day) }, session);
      });
      try { await storage.upload(objectKey, processed.buffer); }
      catch (error) {
        await transaction(async session => {
          if (await repository.setImageStatus(store, imageId, 'uploading', 'failed', session)) await repository.releaseImage(store, draftId, session);
        }); throw error;
      }
      const ready = await transaction(async session => {
        const current = await repository.touchDraft(store, draftId, now(), session);
        return repository.setImageStatus(store, imageId, 'uploading', current ? 'ready' : 'deletePending', session);
      });
      if (!ready || ready.status !== 'ready') throw new AppError(409, 'LEAD_DRAFT_UNAVAILABLE');
      return imageView(ready);
    },
    async submit(store, identity, token, input, locale = 'en') {
      const userId = await customer(store, identity), draftId = id(input.draftId), timestamp = now();
      return transaction(async session => {
        const existing = await repository.findByDraft(store, draftId, session);
        if (existing) {
          if (!equalToken(existing.draftTokenHash, token)) throw new AppError(409, 'LEAD_DRAFT_UNAVAILABLE');
          if (!existing.userId && new Date(existing.trackingExpiresAt) <= now()) throw new AppError(404, 'LEAD_NOT_FOUND');
          const normalized = request(input, existing.formSnapshot);
          if ((existing.userId ? String(existing.userId) : null) !== userId
            || hash(JSON.stringify(canonical(normalized))) !== existing.requestHash) throw new AppError(409, 'LEAD_REQUEST_CONFLICT');
          return receipt(existing, false, locale);
        }
        const owned = await draft(store, draftId, token, session);
        if (!await repository.touchDraft(store, draftId, timestamp, session)) throw new AppError(409, 'LEAD_DRAFT_UNAVAILABLE');
        await customer(store, identity, session);
        const form = await forms.getForSubmission(store, owned.formType, input.formVersion, session);
        const normalized = request(input, form);
        const selections = normalized.wholesaleRequests.length ? await wholesale.getForSubmission(store, normalized.wholesaleRequests, session) : [];
        const leadId = randomBytes(12).toString('hex');
        for (const imageId of normalized.imageIds) {
          const image = await repository.findImage(store, imageId, session);
          if (!image || String(image.draftId) !== draftId || image.status !== 'ready' || new Date(image.expiresAt) <= timestamp) throw new AppError(409, 'LEAD_IMAGE_CONFLICT');
          if (!await repository.setImageStatus(store, imageId, 'ready', 'attached', session, { leadId })) throw new AppError(409, 'LEAD_IMAGE_CONFLICT');
        }
        const data = { _id: leadId, store, draftId, draftTokenHash: owned.tokenHash, requestHash: hash(JSON.stringify(canonical(normalized))),
          formType: owned.formType, userId, notificationLocale: locale, formSnapshot: form, contact: normalized.contact, answers: normalized.answers,
          wholesaleRequests: selections, imageIds: normalized.imageIds, status: 'submitted', contactedAt: null, contactedBy: null,
          trackingHash: null, trackingExpiresAt: userId ? null : new Date(timestamp.getTime() + 90 * day) };
        if (!userId) data.trackingHash = hash(tokenFor(data));
        const lead = await repository.create(data, session);
        await repository.retireUnused(store, draftId, session);
        const completed = await repository.finishDraft(store, draftId, timestamp, session);
        if (completed.matchedCount !== 1) throw new AppError(409, 'LEAD_DRAFT_UNAVAILABLE');
        await notifications?.enqueue({ store, resourceId: leadId, event: 'lead.submitted', resourceStatus: 'submitted',
          eventAt: timestamp, to: normalized.contact.email, locale }, session);
        return receipt(lead, true, locale);
      });
    },
    async track(store, leadId, token, locale = 'en') {
      checkStore(store); const row = await repository.findTracking(store, id(leadId));
      if (!row || row.userId || new Date(row.trackingExpiresAt) <= now() || !equalToken(row.trackingHash, token)) throw new AppError(404, 'LEAD_NOT_FOUND');
      return leadView(row, locale);
    },
    async list(store, identity, input, locale, dashboard = false) {
      checkStore(store); const userId = dashboard ? null : await customer(store, identity);
      if (dashboard) await staff(store, identity); else if (!userId) throw new AppError(401, 'UNAUTHORIZED');
      const selected = { ...input, page: input.page ?? 1, limit: input.limit ?? 20, ...(dashboard ? {} : { userId }) };
      const [rows, total] = await repository.list(store, selected);
      return { items: rows.map(row => leadView(row, dashboard ? undefined : locale, dashboard)),
        pagination: { page: selected.page, limit: selected.limit, total, pages: Math.ceil(total / selected.limit) } };
    },
    async get(store, identity, leadId, locale, dashboard = false) {
      checkStore(store); const userId = dashboard ? null : await customer(store, identity);
      if (dashboard) await staff(store, identity); else if (!userId) throw new AppError(401, 'UNAUTHORIZED');
      const row = await repository.find(store, id(leadId));
      if (!row || (!dashboard && String(row.userId) !== userId)) throw new AppError(404, 'LEAD_NOT_FOUND');
      return leadView(row, dashboard ? undefined : locale, dashboard);
    },
    async contacted(store, identity, leadId) {
      checkStore(store); leadId = id(leadId);
      return transaction(async session => {
        const actor = await staff(store, identity, session), previous = await repository.find(store, leadId, session);
        if (!previous) throw new AppError(404, 'LEAD_NOT_FOUND');
        if (previous.status === 'contacted') return leadView(previous, undefined, true);
        const changed = await repository.contacted(store, leadId, actor._id, now(), session);
        if (!changed) throw new AppError(409, 'LEAD_STATUS_CONFLICT');
        await repository.audit({ store, leadId, actorId: actor._id, action: 'contacted' }, session);
        await notifications?.enqueue({ store, resourceId: leadId, event: 'lead.contacted', resourceStatus: 'contacted',
          eventAt: changed.contactedAt, to: changed.contact.email, locale: changed.notificationLocale ?? 'en' }, session);
        return leadView(changed, undefined, true);
      });
    },
    async readImage(store, identity, leadId, imageId) {
      checkStore(store); await staff(store, identity);
      leadId = id(leadId); imageId = id(imageId);
      const lead = await repository.find(store, id(leadId)), image = await repository.findImage(store, id(imageId));
      if (!lead || !lead.imageIds.map(String).includes(imageId) || !image || image.status !== 'attached' || String(image.leadId) !== leadId) throw new AppError(404, 'LEAD_IMAGE_NOT_FOUND');
      return storage.read(image.objectKey, { endpoint: image.endpoint, zone: image.zone });
    },
    hasOfferReferences: (offerId, session) => repository.hasOfferReferences(offerId, session),
    async getEmailSource(leadId) {
      const row = await repository.findForEmail(id(leadId)); if (!row) return null;
      const candidate = row.userId ? null : tokenFor(row);
      const valid = row.userId || (new Date(row.trackingExpiresAt) > now() && equalToken(row.trackingHash, candidate));
      return { name: row.contact.name, trackingToken: valid ? candidate : null, canTrack: Boolean(valid) };
    },
    async cleanupImages() {
      storage.assertReady(); const result = { removed: 0, failed: 0 };
      for (let batch = 0; batch < 25; batch++) {
        const images = await repository.cleanupCandidates(now()); let progress = 0;
        for (const image of images) {
          const claimed = await repository.claimCleanup(String(image._id), now()); if (!claimed) continue;
          try { await storage.remove(claimed.objectKey, { endpoint: claimed.endpoint, zone: claimed.zone }); await repository.completeCleanup(String(claimed._id)); result.removed++; progress++; }
          catch { result.failed++; logger.error({ event: 'lead_image_cleanup_failed', imageId: String(claimed._id) }); break; }
        }
        if (result.failed || images.length < 50 || !progress) break;
      }
      return result;
    },
  };
}
