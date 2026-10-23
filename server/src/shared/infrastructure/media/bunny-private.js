import { createHash } from 'node:crypto';
import { AppError } from '../../errors/app-error.js';

export function createPrivateBunnyStorage(config, { request = fetch, validKey, unavailableCode, failedCode }) {
  const assertReady = () => { if (!config) throw new AppError(503, unavailableCode); };
  async function send(method, key, buffer, scope) {
    assertReady();
    if (!validKey.test(key) || (scope && (scope.zone !== config.zone || scope.endpoint !== config.endpoint))) {
      throw new AppError(503, unavailableCode);
    }
    let response;
    try {
      response = await request(`${config.endpoint}/${encodeURIComponent(config.zone)}/${key}`, {
        method, redirect: 'error', signal: AbortSignal.timeout(15000),
        headers: { AccessKey: config.accessKey, ...(buffer ? { 'Content-Type': 'image/webp',
          Checksum: createHash('sha256').update(buffer).digest('hex').toUpperCase() } : {}) },
        ...(buffer ? { body: buffer } : {}),
      });
      if (method === 'GET') {
        if (response.status !== 200 || !response.body) throw new Error('Proof unavailable.');
        let size = 0; const chunks = [];
        for await (const chunk of response.body) {
          size += chunk.length;
          if (size > 5 * 1024 * 1024) throw new Error('Proof too large.');
          chunks.push(Buffer.from(chunk));
        }
        if (!size) throw new Error('Proof empty.');
        return Buffer.concat(chunks);
      }
      if (method === 'PUT' ? response.status !== 201 : ![200, 204, 404].includes(response.status)) throw new Error('Proof storage rejected request.');
    } catch { throw new AppError(502, failedCode); }
    finally { try { await response?.body?.cancel(); } catch { /* The bounded reader already consumed or closed the stream. */ } }
  }
  return {
    assertReady,
    scope() { assertReady(); return { endpoint: config.endpoint, zone: config.zone }; },
    upload: (key, buffer) => send('PUT', key, buffer),
    read: (key, scope) => send('GET', key, null, scope),
    remove: (key, scope) => send('DELETE', key, null, scope),
  };
}
