import { randomBytes } from 'node:crypto';
import { AppError } from '../../shared/errors/app-error.js';
import { processCatalogImage } from '../../shared/infrastructure/media/image.js';
import { logger as defaultLogger } from '../../shared/utils/logger.js';
import { mediaRepository } from './media.repository.js';

const imageView = asset => ({ id: String(asset._id), url: asset.url, width: asset.width, height: asset.height });
const checkScope = (store, kind, targetId) => {
  if (!['b2c', 'b2b'].includes(store) || !['product', 'category', 'size-chart-en', 'size-chart-ar', 'homepage-desktop', 'homepage-mobile'].includes(kind)
    || (store === 'b2b' && !['product', 'homepage-desktop', 'homepage-mobile'].includes(kind)) || !/^[a-f0-9]{24}$/.test(targetId)) {
    throw new AppError(422, 'INVALID_FIELD');
  }
};

export function createMediaService({ auth, storage, targets, repository = mediaRepository,
  now = () => new Date(), logger = defaultLogger }) {
  async function cleanup(target, maxBatches = 25) {
    storage.assertReady();
    const result = { removed: 0, failed: 0 };
    for (let batch = 0; batch < maxBatches; batch++) {
      const candidates = await repository.cleanupCandidates(now(), target);
      const before = result.removed;
      for (let start = 0; start < candidates.length; start += 5) {
        await Promise.all(candidates.slice(start, start + 5).map(async asset => {
          const claimed = await repository.claimCleanup(asset._id, now());
          if (!claimed) return;
          try {
            await storage.remove(claimed.objectKey, { endpoint: claimed.endpoint, zone: claimed.zone });
            await repository.completeCleanup(claimed._id);
            result.removed++;
          } catch {
            result.failed++;
            logger.error({ event: 'media_cleanup_failed', assetId: String(claimed._id) });
          }
        }));
        if (result.failed) break;
      }
      if (candidates.length < 50 || result.failed || result.removed === before) break;
    }
    return result;
  }
  return {
    async upload(store, identity, kind, targetId, buffer, contentType) {
      targetId = String(targetId).toLowerCase();
      checkScope(store, kind, targetId);
      const actor = await auth.authorizeStaff(store, identity, ['superAdmin', 'admin']);
      await targets[kind].getStaff(store, identity, targetId);
      storage.assertReady();
      const image = await processCatalogImage(buffer, contentType);
      const assetId = randomBytes(12).toString('hex');
      const objectKey = `narmer/${store}/catalog/${kind}/${targetId}/${assetId}.webp`;
      // Save the cleanup obligation before PUT: a timeout does not prove that Bunny rejected the upload.
      const asset = await repository.create({ _id: assetId, store, kind, targetId, actorId: actor._id,
        objectKey, ...storage.scope(), url: storage.url(objectKey), width: image.width, height: image.height,
        status: 'uploading', expiresAt: new Date(now().getTime() + 24 * 60 * 60 * 1000) });
      await storage.upload(objectKey, image.buffer);
      const ready = await repository.ready(assetId, now());
      if (!ready) throw new AppError(409, 'MEDIA_CONFLICT');
      return imageView(asset);
    },
    async replace(store, kind, targetId, requestedIds, previousIds, session) {
      targetId = String(targetId).toLowerCase();
      checkScope(store, kind, targetId);
      if (!session) throw new Error('Image attachment requires a transaction session.');
      if (!Array.isArray(requestedIds) || requestedIds.length > 1010
        || requestedIds.some(value => typeof value !== 'string' || !/^[a-f0-9]{24}$/i.test(value))) {
        throw new AppError(422, 'INVALID_IMAGE');
      }
      const ids = [...new Set(requestedIds.map(value => value.toLowerCase()))];
      const timestamp = now();
      const assets = ids.length ? await repository.find(store, kind, targetId, ids, session) : [];
      const previous = new Set(previousIds.map(String));
      if (assets.length !== ids.length || assets.some(asset => asset.status === 'attached' ? !previous.has(String(asset._id))
        : asset.status !== 'ready' || asset.expiresAt <= timestamp)) throw new AppError(409, 'MEDIA_CONFLICT');
      if (ids.length) {
        const attached = await repository.attach(store, kind, targetId, ids, timestamp, session);
        if (attached.matchedCount !== ids.length) throw new AppError(409, 'MEDIA_CONFLICT');
      }
      const removed = [...previous].filter(value => !ids.includes(value));
      if (removed.length) await repository.retire(store, kind, targetId, removed, session);
      return new Map(assets.map(asset => [String(asset._id), imageView(asset)]));
    },
    cleanup,
    async cleanupTarget(store, kind, targetId) {
      try { await cleanup({ store, kind, targetId }, 1); }
      catch { logger.error({ event: 'media_cleanup_deferred', kind, targetId: String(targetId) }); }
    },
  };
}
