import { createPrivateBunnyStorage } from './bunny-private.js';

export function createBunnyProofStorage(config, { request = fetch } = {}) {
  return createPrivateBunnyStorage(config, { request, validKey: /^narmer\/b2c\/proofs\/[a-f0-9]{24}\.webp$/,
    unavailableCode: 'PROOF_STORAGE_UNAVAILABLE', failedCode: 'PROOF_STORAGE_FAILED' });
}
