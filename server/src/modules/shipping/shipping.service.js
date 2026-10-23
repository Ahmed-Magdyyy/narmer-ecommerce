import { AppError } from '../../shared/errors/app-error.js';
import { runTransaction } from '../../shared/utils/transaction.js';
import { shippingRepository } from './shipping.repository.js';

const invalid = () => { throw new AppError(422, 'VALIDATION_ERROR'); };
const checkStore = store => { if (store !== 'b2c') throw new AppError(400, 'INVALID_STORE'); };
const money = value => { if (!Number.isSafeInteger(value) || value < 0 || value > 1000000000) invalid(); return value; };
const code = value => {
  if (typeof value !== 'string') invalid();
  const result = value.trim().toLowerCase();
  if (result.length > 100 || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(result)) invalid();
  return result;
};
const view = (row, locale) => ({ id: String(row._id), governorateCode: row.governorateCode,
  name: locale ? row.name[locale] : row.name, fee: row.fee, currency: 'EGP' });
const defaultView = settings => ({ configured: Boolean(settings), defaultFee: settings?.defaultFee ?? null, currency: 'EGP' });

function fields(input, create) {
  const selected = {};
  for (const locale of ['ar', 'en']) {
    if (create || Object.hasOwn(input.name ?? {}, locale)) {
      const value = input.name?.[locale];
      if (typeof value !== 'string' || !value.trim() || value.trim().length > 150) invalid();
      selected[`name.${locale}`] = value.trim();
    }
  }
  if (create || Object.hasOwn(input, 'fee')) selected.fee = money(input.fee);
  return selected;
}

export function createShippingService({ auth, repository = shippingRepository, transaction = runTransaction }) {
  const staff = (store, identity, session) => auth.authorizeStaff(store, identity, ['superAdmin', 'admin'], session);
  async function list(store, input = {}, identity, locale) {
    checkStore(store);
    if (identity) await staff(store, identity);
    const page = input.page ?? 1;
    const limit = input.limit ?? 20;
    const [[rows, total], settings] = await Promise.all([repository.list(store, { page, limit }), repository.getDefault(store)]);
    return { items: rows.map(row => view(row, locale)), default: defaultView(settings),
      pagination: { page, limit, total, pages: Math.ceil(total / limit) } };
  }
  async function mutate(store, identity, action, feeId, input) {
    checkStore(store);
    try {
      return await transaction(async session => {
        const actor = await staff(store, identity, session);
        const previous = action === 'created' ? null : await repository.findById(store, feeId, session);
        if (action !== 'created' && !previous) throw new AppError(404, 'SHIPPING_FEE_NOT_FOUND');
        let changed;
        let selected = {};
        let governorateCode = previous?.governorateCode;
        if (action === 'deleted') await repository.remove(store, feeId, session);
        else {
          selected = fields(input, action === 'created');
          if (action === 'created') {
            governorateCode = code(input.governorateCode);
            changed = await repository.create({ store, governorateCode, fee: selected.fee,
              name: { ar: selected['name.ar'], en: selected['name.en'] } }, session);
          } else {
            if (Object.hasOwn(input, 'governorateCode') && code(input.governorateCode) !== governorateCode) {
              throw new AppError(409, 'SHIPPING_CODE_IMMUTABLE');
            }
            if (!Object.keys(selected).length) invalid();
            changed = await repository.update(store, feeId, selected, session);
          }
        }
        if (action !== 'deleted' && !changed) throw new AppError(409, 'SHIPPING_CONFLICT');
        await repository.audit({ store, actorId: actor._id, feeId: changed?._id ?? previous._id, governorateCode,
          action, fields: action === 'created' ? ['governorateCode', ...Object.keys(selected)] : Object.keys(selected) }, session);
        return changed ? view(changed) : null;
      });
    } catch (error) {
      if (error.code === 11000) throw new AppError(409, 'SHIPPING_FEE_EXISTS');
      throw error;
    }
  }
  return {
    browse: (store, input, locale) => list(store, input, null, locale),
    list: (store, identity, input) => list(store, input, identity),
    async getStaff(store, identity, feeId) {
      checkStore(store);
      await staff(store, identity);
      const row = await repository.findById(store, feeId);
      if (!row) throw new AppError(404, 'SHIPPING_FEE_NOT_FOUND');
      return view(row);
    },
    async getDefault(store, identity) { checkStore(store); await staff(store, identity); return defaultView(await repository.getDefault(store)); },
    async setDefault(store, identity, input) {
      checkStore(store);
      const defaultFee = money(input.defaultFee);
      try { return await transaction(async session => {
        const actor = await staff(store, identity, session);
        const settings = await repository.setDefault(store, defaultFee, session);
        await repository.audit({ store, actorId: actor._id, action: 'default.updated', fields: ['defaultFee'] }, session);
        return defaultView(settings);
      }); } catch (error) {
        if (error.code === 11000) throw new AppError(409, 'SHIPPING_CONFLICT');
        throw error;
      }
    },
    async resolve(store, governorateCode, { session = null, locale } = {}) {
      checkStore(store);
      governorateCode = code(governorateCode);
      const override = await repository.findByCode(store, governorateCode, session);
      if (override) return { ...view(override, locale), source: 'override' };
      const settings = await repository.getDefault(store, session);
      if (!settings) throw new AppError(503, 'SHIPPING_NOT_CONFIGURED');
      return { id: null, governorateCode, name: null, fee: settings.defaultFee, source: 'default', currency: 'EGP' };
    },
    create: (store, identity, input) => mutate(store, identity, 'created', null, input),
    update: (store, identity, feeId, input) => mutate(store, identity, 'updated', feeId, input),
    remove: (store, identity, feeId) => mutate(store, identity, 'deleted', feeId, {}),
  };
}
