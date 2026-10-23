import { readEnv } from '../../src/config/env.js';

export const testEnv = { MONGODB_URI: 'mongodb://127.0.0.1:27017/narmer_test',
  JWT_SECRET: 'test-jwt-key-'.repeat(4), OTP_SECRET: 'test-otp-key-'.repeat(4), COUPON_IDENTITY_SECRET: 'test-coupon-key-'.repeat(4),
  NODE_ENV: 'test', CORS_ORIGINS: 'https://shop.example' };
export const testConfig = readEnv(testEnv);
