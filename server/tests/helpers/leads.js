import { randomBytes } from 'node:crypto';
import { AppError } from '../../src/shared/errors/app-error.js';
import { formsFixture } from './forms.js';
import { wholesaleFixture } from './wholesale.js';
import { createFormsService } from '../../src/modules/forms/forms.service.js';
import { createWholesaleService } from '../../src/modules/wholesale/wholesale.service.js';
import { createLeadsService } from '../../src/modules/leads/leads.service.js';

export const emptyLeadsRepository = { async hasOfferReferences() { return false; } };
export const leadContact = { name: 'Customer', phone: '+20 100 123 4567', governorate: 'Cairo', district: 'Nasr City' };
export function leadsFixture(auth) {
  const p = wholesaleFixture(auth), f = formsFixture(auth), leadRows = new Map(), draftRows = new Map(), imageRows = new Map(), audits = [], objects = new Map();
  let clock = new Date('2026-10-12T00:00:00Z'), failCreate = false, failAudit = false, failUpload = false, failRemove = false;
  const now = () => new Date(clock), copy = value => structuredClone(value);
  const scope = (row, store) => row?.store === store;
  const live = row => row?.status === 'open' && row.expiresAt > now();
  const eligible = row => row.status === 'deletePending' || (['uploading', 'ready', 'failed'].includes(row.status) && row.expiresAt <= now());
  const repository = {
    async createDraft(data) { const row = { _id: randomBytes(12).toString('hex'), ...copy(data) }; draftRows.set(row._id, row); return copy(row); },
    async findDraft(store, id) { const row = draftRows.get(id); return copy(scope(row, store) ? row : null); },
    async touchDraft(store, id) { const row = draftRows.get(id); if (!scope(row, store) || !live(row)) return null; row.revision++; return copy(row); },
    async reserveImage(store, id) { const row = draftRows.get(id); if (!scope(row, store) || !live(row) || row.imageSlots >= 5) return null; row.imageSlots++; row.revision++; return copy(row); },
    async releaseImage(store, id) { const row = draftRows.get(id); if (scope(row, store) && row.imageSlots > 0) row.imageSlots--; },
    async finishDraft(store, id) { const row = draftRows.get(id); if (!scope(row, store) || !live(row)) return { matchedCount: 0 }; row.status = 'submitted'; row.revision++; return { matchedCount: 1 }; },
    async createImage(data) { imageRows.set(data._id, copy(data)); return copy(data); },
    async findImage(store, id) { const row = imageRows.get(id); return copy(scope(row, store) ? row : null); },
    async draftImages(store, draftId) { return copy([...imageRows.values()].filter(row => row.store === store && row.draftId === draftId && ['uploading', 'ready'].includes(row.status))); },
    async setImageStatus(store, id, previous, status, session, extra = {}) { const row = imageRows.get(id); if (!scope(row, store) || row.status !== previous) return null; Object.assign(row, copy(extra), { status }); return copy(row); },
    async retireUnused(store, draftId) { for (const row of imageRows.values()) if (row.store === store && row.draftId === draftId && row.status === 'ready') row.status = 'deletePending'; },
    async create(data) { if (failCreate) throw new Error('lead write failed'); if ([...leadRows.values()].some(row => row.draftId === data.draftId)) throw Object.assign(new Error('duplicate'), { code: 11000 }); const row = { ...copy(data), createdAt: now() }; leadRows.set(row._id, row); return copy(row); },
    async findByDraft(store, draftId) { return copy([...leadRows.values()].find(row => row.store === store && row.draftId === draftId) ?? null); },
    async find(store, id) { const row = leadRows.get(id); return copy(scope(row, store) ? row : null); },
    async findTracking(store, id) { return this.find(store, id); },
    async findForEmail(id) { return this.find('b2b', id); },
    async list(store, input) { const rows = [...leadRows.values()].filter(row => row.store === store && (!input.userId || row.userId === input.userId) && (!input.status || row.status === input.status) && (!input.formType || row.formType === input.formType)); return [copy(rows.slice((input.page - 1) * input.limit, input.page * input.limit)), rows.length]; },
    async contacted(store, id, actorId, at) { const row = leadRows.get(id); if (!scope(row, store) || row.status !== 'submitted') return null; Object.assign(row, { status: 'contacted', contactedAt: at, contactedBy: actorId }); return copy(row); },
    async audit(data) { if (failAudit) throw new Error('lead audit failed'); audits.push(copy(data)); },
    async hasOfferReferences(offerId) { return [...leadRows.values()].some(row => row.wholesaleRequests.some(offer => offer.id === offerId)); },
    async cleanupCandidates() { return copy([...imageRows.values()].filter(eligible).slice(0, 50)); },
    async claimCleanup(id) { const row = imageRows.get(id); if (!row || !eligible(row)) return null; row.status = 'deletePending'; return copy(row); },
    async completeCleanup(id) { if (imageRows.get(id)?.status === 'deletePending') imageRows.delete(id); },
  };
  const storage = {
    assertReady() {}, scope: () => ({ endpoint: 'https://storage.bunnycdn.com', zone: 'private-tests' }),
    async upload(key, bytes) { objects.set(key, Buffer.from(bytes)); if (failUpload) throw new AppError(502, 'LEAD_STORAGE_FAILED'); },
    async read(key) { if (!objects.has(key)) throw new AppError(502, 'LEAD_STORAGE_FAILED'); return Buffer.from(objects.get(key)); },
    async remove(key) { if (failRemove) throw new Error('remove failed'); objects.delete(key); },
  };
  const transaction = work => p.transaction(async session => {
    const maps = [leadRows, draftRows, imageRows, f.rows], snapshots = maps.map(map => copy([...map])), auditSnapshot = copy(audits);
    try { return await work(session); }
    catch (error) { maps.forEach((map, index) => { map.clear(); for (const [id, row] of snapshots[index]) map.set(id, row); }); audits.splice(0, audits.length, ...auditSnapshot); throw error; }
  });
  let leads;
  const forms = createFormsService({ auth, repository: f.repository, transaction });
  const wholesale = createWholesaleService({ auth, products: p.products, media: p.media, repository: p.wholesaleRepository, transaction,
    references: { hasOfferReferences: (...args) => leads.hasOfferReferences(...args) } });
  const options = { auth, forms, wholesale, storage, repository, transaction, now, trackingSecret: 'test-lead-tracking-secret-at-least-32-bytes' };
  leads = createLeadsService(options);
  return { ...p, forms, formRepository: f.repository, wholesale, leads, options, repository, leadRows, draftRows, imageRows, audits, objects, storage, transaction,
    advance(ms) { clock = new Date(clock.getTime() + ms); }, failCreate(value) { failCreate = value; }, failAudit(value) { failAudit = value; }, failUpload(value) { failUpload = value; }, failRemove(value) { failRemove = value; } };
}
