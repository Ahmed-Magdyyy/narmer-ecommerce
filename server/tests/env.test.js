import test from 'node:test';
import assert from 'node:assert/strict';
import { readEnv } from '../src/config/env.js';
import { testEnv } from './helpers/config.js';

const base = { ...testEnv, NODE_ENV: undefined, CORS_ORIGINS: undefined };
const integrationOrigins = [5294, 5295, 5284, 5283].map(port => `http://127.0.0.1:${port}`);

test('proof storage is optional, separately configured and never accepts the public catalog zone', () => {
  assert.equal(readEnv(base).bunnyProof, null);
  const proof = { BUNNY_PROOF_STORAGE_ZONE: 'narmer-private', BUNNY_PROOF_ACCESS_KEY: 'secret-password' };
  assert.equal(readEnv({ ...base, ...proof }).bunnyProof.zone, 'narmer-private');
  for (const fields of [{ BUNNY_PROOF_ACCESS_KEY: '' }, { BUNNY_PROOF_STORAGE_ZONE: '../zone' },
    { BUNNY_PROOF_STORAGE_ENDPOINT: 'https://attacker.example' },
    { BUNNY_PUBLIC_STORAGE_ZONE: 'narmer-private', BUNNY_PUBLIC_ACCESS_KEY: 'public-key', BUNNY_PUBLIC_CDN_ORIGIN: 'https://images.example' }]) {
    assert.throws(() => readEnv({ ...base, ...proof, ...fields }), error => !error.message.includes('secret-password'));
  }
  assert.throws(() => readEnv({ ...base, ...proof, BUNNY_PUBLIC_STORAGE_ZONE: 'NARMER-PRIVATE',
    BUNNY_PUBLIC_ACCESS_KEY: 'public-key', BUNNY_PUBLIC_CDN_ORIGIN: 'https://images.example' }), /separate private/);
});

test('environment defaults are local and do not trust proxy headers', () => {
  const config = readEnv(base);
  assert.equal(config.port, 3000);
  assert.equal(config.host, '127.0.0.1');
  assert.equal(config.trustProxy, 0);
  assert.equal(config.defaultLocale, 'en');
  assert.deepEqual(config.corsOrigins, integrationOrigins);
});

test('explicit environment settings are parsed without reading ambient database settings', () => {
  const config = readEnv({ ...base, PORT: '4000', HOST: '0.0.0.0', NODE_ENV: 'production',
    DEFAULT_LOCALE: 'ar', TRUST_PROXY: '1', CORS_ORIGINS: 'https://shop.example,http://localhost:5173' });
  assert.equal(config.port, 4000);
  assert.equal(config.defaultLocale, 'ar');
  assert.equal(config.trustProxy, 1);
  assert.deepEqual(config.corsOrigins, ['https://shop.example', 'http://localhost:5173', ...integrationOrigins]);
  assert.throws(() => readEnv({ DATABASE_URL: base.MONGODB_URI }), /MONGODB_URI/);
});

test('integration origins stay available in production without duplicating configured origins', () => {
  const config = readEnv({ ...base, NODE_ENV: 'production', CORS_ORIGINS: integrationOrigins[0] });
  assert.deepEqual(config.corsOrigins, integrationOrigins);
});

test('invalid configuration fails without including credentials in the error', () => {
  for (const overrides of [
    { PORT: '3000junk' }, { PORT: '0' }, { PORT: '65536' }, { PORT: '-1' },
    { TRUST_PROXY: 'true' }, { NODE_ENV: 'prod' }, { DEFAULT_LOCALE: 'fr' }, { HOST: ' ' },
    { MONGODB_URI: 'secret-password' }, { CORS_ORIGINS: '*' },
    { CORS_ORIGINS: 'https://shop.example/path' },
    { CORS_ORIGINS: 'https://user:secret-password@shop.example' },
    { JWT_SECRET: '' }, { OTP_SECRET: 'short' }, { OTP_SECRET: base.JWT_SECRET },
    { COUPON_IDENTITY_SECRET: undefined }, { COUPON_IDENTITY_SECRET: 'short' },
    { COUPON_IDENTITY_SECRET: base.JWT_SECRET }, { COUPON_IDENTITY_SECRET: base.OTP_SECRET },
    { JWT_SECRET: 'placeholder'.repeat(4) }, { SMTP_HOST: 'smtp.example' },
  ]) {
    assert.throws(() => readEnv({ ...base, ...overrides }), error => {
      assert.equal(error.message.includes('secret-password'), false);
      return true;
    });
  }
});

test('SMTP stays optional but partial configured credentials are rejected', () => {
  assert.equal(readEnv(base).smtp, null);
  const smtp = readEnv({ ...base, SMTP_HOST: 'smtp.example', SMTP_USER: 'sender',
    SMTP_PASSWORD: 'secret-password', SMTP_FROM: 'sender@example.com', SMTP_PORT: '465' }).smtp;
  assert.equal(smtp.port, 465);
  assert.throws(() => readEnv({ ...base, SMTP_HOST: 'smtp.example' }), /SMTP_/);
});

test('Bunny catalog configuration is optional, complete and restricted to trusted HTTPS origins', () => {
  assert.equal(readEnv(base).bunnyPublic, null);
  const settings = { BUNNY_PUBLIC_STORAGE_ZONE: 'narmer-public', BUNNY_PUBLIC_ACCESS_KEY: 'secret-password',
    BUNNY_PUBLIC_CDN_ORIGIN: 'https://images.example', BUNNY_PUBLIC_STORAGE_ENDPOINT: 'https://uk.storage.bunnycdn.com' };
  assert.equal(readEnv({ ...base, ...settings }).bunnyPublic.endpoint, settings.BUNNY_PUBLIC_STORAGE_ENDPOINT);
  assert.equal(readEnv({ ...base, ...settings, BUNNY_PUBLIC_STORAGE_ENDPOINT: undefined }).bunnyPublic.endpoint, 'https://storage.bunnycdn.com');
  for (const overrides of [{ BUNNY_PUBLIC_ACCESS_KEY: '' }, { BUNNY_PUBLIC_STORAGE_ZONE: '../zone' },
    { BUNNY_PUBLIC_STORAGE_ENDPOINT: 'https://attacker.example' }, { BUNNY_PUBLIC_STORAGE_ENDPOINT: 'https://storage.bunnycdn.com/path' },
    { BUNNY_PUBLIC_CDN_ORIGIN: 'http://images.example' }, { BUNNY_PUBLIC_CDN_ORIGIN: 'https://user:secret-password@images.example' },
    { BUNNY_PUBLIC_CDN_ORIGIN: 'https://images.example/' }]) {
    assert.throws(() => readEnv({ ...base, ...settings, ...overrides }), error => !error.message.includes('secret-password'));
  }
});
