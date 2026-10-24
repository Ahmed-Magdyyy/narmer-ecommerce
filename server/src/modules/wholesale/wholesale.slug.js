export const offerSlugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const legacyOfferIdPattern = /^[a-f0-9]{24}$/i;

export function isOfferSlug(value) {
  return typeof value === 'string' && value.length >= 1 && value.length <= 150
    && offerSlugPattern.test(value) && !legacyOfferIdPattern.test(value);
}

export function offerSlugBase(name) {
  let base = name.normalize('NFKD').toLowerCase().replace(/[^a-z0-9]+/g, '-')
    .slice(0, 96).replace(/^-+|-+$/g, '') || 'offer';
  if (legacyOfferIdPattern.test(base)) base += '-offer';
  return base;
}

export function offerSlugCandidate(base, number) {
  const suffix = number === 1 ? '' : `-${number}`;
  return base.slice(0, 150 - suffix.length).replace(/-+$/g, '') + suffix;
}
