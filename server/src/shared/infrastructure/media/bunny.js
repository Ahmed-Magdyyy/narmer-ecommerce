import { createHash } from 'node:crypto';
import { AppError } from '../../errors/app-error.js';

const objectKey = /^narmer\/(?:b2c\/catalog\/(?:product|category|size-chart-(?:en|ar)|homepage-(?:desktop|mobile))|b2b\/catalog\/(?:product|homepage-(?:desktop|mobile)))\/[a-f0-9]{24}\/[a-f0-9]{24}\.webp$/;

export function createBunnyStorage(config, { request = fetch } = {}) {
  const assertReady = () => { if (!config) throw new AppError(503, 'MEDIA_UNAVAILABLE'); };
  function check(key, scope) {
    assertReady();
    if (!objectKey.test(key) || (scope && (scope.endpoint !== config.endpoint || scope.zone !== config.zone))) {
      throw new AppError(503, 'MEDIA_UNAVAILABLE');
    }
  }
  async function send(method, key, buffer, scope) {
    check(key, scope);
    try {
      const response = await request(`${config.endpoint}/${encodeURIComponent(config.zone)}/${key}`, {
        method, redirect: 'error', signal: AbortSignal.timeout(15000),
        headers: { AccessKey: config.accessKey, ...(buffer ? { 'Content-Type': 'image/webp',
          Checksum: createHash('sha256').update(buffer).digest('hex').toUpperCase() } : {}) },
        ...(buffer ? { body: buffer } : {}),
      });
      await response.body?.cancel();
      if (method === 'PUT' ? response.status !== 201 : ![200, 204, 404].includes(response.status)) {
        throw new Error('Storage rejected the request.');
      }
    } catch { throw new AppError(502, 'MEDIA_STORAGE_FAILED'); }
  }
  return {
    assertReady,
    scope() { assertReady(); return { endpoint: config.endpoint, zone: config.zone }; },
    url(key) { check(key); return `${config.cdnOrigin}/${key}`; },
    upload: (key, buffer) => send('PUT', key, buffer),
    remove: (key, scope) => send('DELETE', key, null, scope),
  };
}
