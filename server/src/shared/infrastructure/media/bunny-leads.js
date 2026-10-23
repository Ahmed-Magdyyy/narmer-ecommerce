import { createPrivateBunnyStorage } from './bunny-private.js';

export function createBunnyLeadStorage(config, { request = fetch } = {}) {
  return createPrivateBunnyStorage(config, { request, validKey: /^narmer\/b2b\/lead-images\/[a-f0-9]{24}\.webp$/,
    unavailableCode: 'LEAD_STORAGE_UNAVAILABLE', failedCode: 'LEAD_STORAGE_FAILED' });
}
