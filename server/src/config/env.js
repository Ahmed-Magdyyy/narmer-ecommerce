function integer(value, fallback, name, min, max) {
  const input = value ?? String(fallback);
  if (!/^\d+$/.test(input) || Number(input) < min || Number(input) > max) {
    throw new Error(`${name} must be an integer between ${min} and ${max}.`);
  }
  return Number(input);
}

function secret(value, name) {
  if (typeof value !== 'string' || Buffer.byteLength(value) < 32 || /change.?me|placeholder/i.test(value)) {
    throw new Error(`${name} must contain at least 32 bytes of secret key material.`);
  }
  return value;
}

function trackingTemplate(value, name, nodeEnv) {
  if (!value?.trim()) return null;
  const template = value.trim();
  let url;
  try { url = new URL(template.replace('{id}', '1'.repeat(24)).replace('{token}', 'x'.repeat(43))); } catch { /* Report only the key. */ }
  if (!url || !['https:', ...(nodeEnv === 'production' ? [] : ['http:'])].includes(url.protocol) || url.username || url.password
    || template.split('{id}').length !== 2 || template.split('{token}').length !== 2
    || template.split('#')[0].includes('{token}') || !url.hash.includes('x'.repeat(43))
    || /[{}]/.test(template.replace('{id}', '').replace('{token}', ''))
    || url.origin !== new URL(template.replace('{id}', '2'.repeat(24)).replace('{token}', 'x'.repeat(43))).origin) {
    throw new Error(`${name} must be an HTTP(S) tracking URL with one {id} and one {token} in the fragment; production requires HTTPS.`);
  }
  return template;
}

export function readEnv(source = process.env) {
  const nodeEnv = source.NODE_ENV ?? 'development';
  if (!['development', 'test', 'production'].includes(nodeEnv)) {
    throw new Error('NODE_ENV must be development, test, or production.');
  }
  const mongodbUri = source.MONGODB_URI;
  if (!mongodbUri || !/^mongodb(?:\+srv)?:\/\//.test(mongodbUri)) {
    throw new Error('MONGODB_URI must be a MongoDB connection string.');
  }
  const defaultLocale = source.DEFAULT_LOCALE ?? 'en';
  if (!['en', 'ar'].includes(defaultLocale)) {
    throw new Error('DEFAULT_LOCALE must be en or ar.');
  }
  const corsOrigins = (source.CORS_ORIGINS ?? '').split(',').map(value => value.trim()).filter(Boolean);
  for (const origin of corsOrigins) {
    let url;
    try { url = new URL(origin); } catch { /* Report the config key, not its value. */ }
    if (!url || !['http:', 'https:'].includes(url.protocol) || url.origin !== origin) {
      throw new Error('CORS_ORIGINS must contain exact HTTP(S) origins separated by commas.');
    }
  }
  const host = source.HOST ?? '127.0.0.1';
  if (!host.trim()) throw new Error('HOST must not be empty.');
  const jwtSecret = secret(source.JWT_SECRET, 'JWT_SECRET');
  const otpSecret = secret(source.OTP_SECRET, 'OTP_SECRET');
  if (jwtSecret === otpSecret) throw new Error('JWT_SECRET and OTP_SECRET must be different.');
  const couponIdentitySecret = secret(source.COUPON_IDENTITY_SECRET, 'COUPON_IDENTITY_SECRET');
  if ([jwtSecret, otpSecret].includes(couponIdentitySecret)) throw new Error('COUPON_IDENTITY_SECRET must be separate from JWT_SECRET and OTP_SECRET.');
  let smtp = null;
  if (source.SMTP_HOST?.trim()) {
    if (!source.SMTP_USER || !source.SMTP_PASSWORD || !source.SMTP_FROM) {
      throw new Error('SMTP_HOST requires SMTP_USER, SMTP_PASSWORD, and SMTP_FROM.');
    }
    smtp = { host: source.SMTP_HOST.trim(), user: source.SMTP_USER,
      password: source.SMTP_PASSWORD, from: source.SMTP_FROM,
      port: integer(source.SMTP_PORT, 587, 'SMTP_PORT', 1, 65535) };
  }
  let bunnyPublic = null;
  const notificationLinks = {
    b2c: trackingTemplate(source.B2C_TRACKING_URL_TEMPLATE, 'B2C_TRACKING_URL_TEMPLATE', nodeEnv),
    b2b: trackingTemplate(source.B2B_TRACKING_URL_TEMPLATE, 'B2B_TRACKING_URL_TEMPLATE', nodeEnv),
  };
  if (Object.values(notificationLinks).some(Boolean) && !smtp) throw new Error('Customer notification links require configured SMTP.');
  if (['BUNNY_PUBLIC_STORAGE_ZONE', 'BUNNY_PUBLIC_ACCESS_KEY', 'BUNNY_PUBLIC_CDN_ORIGIN'].some(key => source[key]?.trim())) {
    const zone = source.BUNNY_PUBLIC_STORAGE_ZONE?.trim();
    const accessKey = source.BUNNY_PUBLIC_ACCESS_KEY?.trim();
    if (!zone || !/^[a-zA-Z0-9_-]{1,100}$/.test(zone) || !accessKey) {
      throw new Error('Bunny public storage requires BUNNY_PUBLIC_STORAGE_ZONE and BUNNY_PUBLIC_ACCESS_KEY.');
    }
    const endpoint = source.BUNNY_PUBLIC_STORAGE_ENDPOINT?.trim() || 'https://storage.bunnycdn.com';
    if (!/^https:\/\/(?:[a-z]{2,3}\.)?storage\.bunnycdn\.com$/.test(endpoint)) {
      throw new Error('BUNNY_PUBLIC_STORAGE_ENDPOINT must be an HTTPS Bunny storage origin.');
    }
    const cdnOrigin = source.BUNNY_PUBLIC_CDN_ORIGIN?.trim();
    let parsed;
    try { parsed = new URL(cdnOrigin); } catch { /* Do not print configuration values. */ }
    if (!parsed || parsed.protocol !== 'https:' || parsed.origin !== cdnOrigin || parsed.username || parsed.password) {
      throw new Error('BUNNY_PUBLIC_CDN_ORIGIN must be an exact HTTPS origin.');
    }
    bunnyPublic = { zone, accessKey, endpoint, cdnOrigin };
  }
  let bunnyProof = null;
  if (['BUNNY_PROOF_STORAGE_ZONE', 'BUNNY_PROOF_ACCESS_KEY'].some(key => source[key]?.trim())) {
    const zone = source.BUNNY_PROOF_STORAGE_ZONE?.trim();
    const accessKey = source.BUNNY_PROOF_ACCESS_KEY?.trim();
    const endpoint = source.BUNNY_PROOF_STORAGE_ENDPOINT?.trim() || 'https://storage.bunnycdn.com';
    if (!zone || !/^[a-zA-Z0-9_-]{1,100}$/.test(zone) || !accessKey
      || !/^https:\/\/(?:[a-z]{2,3}\.)?storage\.bunnycdn\.com$/.test(endpoint)) {
      throw new Error('Proof storage requires a valid private Bunny zone, key and HTTPS storage endpoint.');
    }
    if (zone.toLowerCase() === bunnyPublic?.zone.toLowerCase()) throw new Error('Proof storage must use a separate private Bunny storage zone.');
    bunnyProof = { zone, accessKey, endpoint };
  }
  return {
    nodeEnv, host, mongodbUri, defaultLocale, corsOrigins, jwtSecret, otpSecret, couponIdentitySecret, smtp, bunnyPublic, bunnyProof, notificationLinks,
    port: integer(source.PORT, 3000, 'PORT', 1, 65535),
    trustProxy: integer(source.TRUST_PROXY, 0, 'TRUST_PROXY', 0, 10),
  };
}
