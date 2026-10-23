import { AppError } from '../../shared/errors/app-error.js';

const own = (value, key) => Object.hasOwn(value, key);
const object = value => value && typeof value === 'object' && !Array.isArray(value);
export function normalizeMeasurements(value) {
  if (value === null) return null;
  const errors = [], fail = field => errors.push({ field, location: 'body', code: 'INVALID_FIELD' });
  if (!object(value) || Object.keys(value).some(key => !['unit', 'rows'].includes(key))) fail('measurements');
  if (value?.unit !== 'cm') fail('measurements.unit');
  const rows = value?.rows;
  if (!Array.isArray(rows) || rows.length < 1 || rows.length > 50) fail('measurements.rows');
  const labels = new Set();
  const normalized = Array.isArray(rows) && rows.length <= 50 ? rows.map((row, index) => {
    const prefix = `measurements.rows[${index}]`;
    if (!object(row) || Object.keys(row).some(key => !['size', 'chest', 'length', 'sleeve'].includes(key))) fail(prefix);
    const size = typeof row?.size === 'string' ? row.size.trim() : '';
    if (!size || [...size].length > 30 || labels.has(size.toLowerCase())) fail(`${prefix}.size`);
    labels.add(size.toLowerCase());
    const result = { size };
    for (const field of ['chest', 'length', 'sleeve']) {
      const number = row?.[field], scaled = number * 100;
      // Accept decimal centimetres without rejecting normal binary floating-point representations.
      if (!object(row) || !own(row, field) || typeof number !== 'number' || !Number.isFinite(number)
        || number < 0.01 || number > 1000 || Math.abs(scaled - Math.round(scaled)) > 1e-8) fail(`${prefix}.${field}`);
      result[field] = typeof number === 'number' ? Math.round(scaled) / 100 : number;
    }
    return result;
  }) : [];
  if (errors.length) throw new AppError(422, 'VALIDATION_ERROR', errors);
  return { unit: 'cm', rows: normalized };
}
