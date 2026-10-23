import { AppError } from '../../shared/errors/app-error.js';
import { runTransaction } from '../../shared/utils/transaction.js';
import { formsRepository } from './forms.repository.js';
import { formTypes, fieldTypes, fixedFields, fieldConstraints } from './forms.definitions.js';

const invalid = () => { throw new AppError(422, 'INVALID_FORM'); };
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const safeKey = value => typeof value === 'string' && /^[a-z][a-z0-9_-]{0,39}$/.test(value)
  && !['constructor', 'prototype', '__proto__'].includes(value);
function translations(input, previous, max, required) {
  if (!object(input) || Object.keys(input).some(key => !['ar', 'en'].includes(key))) invalid();
  const result = {};
  for (const locale of ['ar', 'en']) {
    const value = Object.hasOwn(input, locale) ? input[locale] : previous?.[locale];
    if (typeof value !== 'string' || value.trim().length > max || (required && !value.trim())) invalid();
    result[locale] = value.trim();
  }
  return result;
}
function configurableFields(input) {
  if (!Array.isArray(input) || input.length > 40) invalid();
  const used = new Set(fixedFields.map(field => field.key));
  return input.map(field => {
    if (!object(field) || Object.keys(field).some(key => !['key', 'type', 'label', 'required', 'choices'].includes(key))
      || !safeKey(field.key) || used.has(field.key) || !fieldTypes.includes(field.type) || typeof field.required !== 'boolean') invalid();
    used.add(field.key);
    const choices = field.choices === undefined ? [] : field.choices;
    const isChoice = ['select', 'multiselect'].includes(field.type);
    if (!Array.isArray(choices) || choices.length > 50 || (isChoice ? !choices.length : choices.length)) invalid();
    const choiceKeys = new Set();
    return { key: field.key, type: field.type, label: translations(field.label, null, 150, true), required: field.required,
      choices: choices.map(choice => {
        if (!object(choice) || Object.keys(choice).some(key => !['key', 'label'].includes(key))
          || !safeKey(choice.key) || choiceKeys.has(choice.key)) invalid();
        choiceKeys.add(choice.key);
        return { key: choice.key, label: translations(choice.label, null, 150, true) };
      }) };
  });
}
function view(row, locale) {
  const local = value => locale ? (value[locale] || value[locale === 'ar' ? 'en' : 'ar']) : { ...value };
  const field = input => ({ key: input.key, type: input.type, label: local(input.label), required: input.required,
    choices: (input.choices ?? []).map(choice => ({ key: choice.key, label: local(choice.label) })),
    constraints: { ...(input.constraints ?? fieldConstraints[input.type]) } });
  return { id: String(row._id), type: row.type, title: local(row.title), helpText: local(row.helpText),
    isActive: row.isActive, version: row.version, fixedFields: fixedFields.map(field), fields: row.fields.map(field) };
}

export function createFormsService({ auth, repository = formsRepository, transaction = runTransaction } = {}) {
  function checkStore(store) { if (store !== 'b2b') throw new AppError(400, 'INVALID_STORE'); }
  function checkType(type) { if (!formTypes.includes(type)) invalid(); }
  const staff = (store, identity, session) => auth.authorizeStaff(store, identity, ['superAdmin', 'admin'], session);
  async function list(store, identity, locale) {
    checkStore(store);
    if (identity) await staff(store, identity);
    const rows = await repository.list(store, !identity);
    rows.sort((a, b) => formTypes.indexOf(a.type) - formTypes.indexOf(b.type));
    return { items: rows.map(row => view(row, locale)), supportedFieldTypes: [...fieldTypes] };
  }
  async function get(store, type, identity, locale) {
    checkStore(store); checkType(type);
    if (identity) await staff(store, identity);
    const row = await repository.find(store, type);
    if (!row || (!identity && !row.isActive)) throw new AppError(404, 'FORM_NOT_FOUND');
    return view(row, locale);
  }
  return {
    async getForSubmission(store, type, version, session) {
      checkStore(store); checkType(type);
      if (!session) throw new Error('Form submission requires a transaction session.');
      const row = await repository.find(store, type, session);
      if (!row || !row.isActive) throw new AppError(404, 'FORM_NOT_FOUND');
      if (row.version !== version) throw new AppError(409, 'FORM_CONFLICT');
      const locked = await repository.lockForSubmission(store, type, version, session);
      if (!locked) throw new AppError(409, 'FORM_CONFLICT');
      return view(locked);
    },
    browse: (store, locale = 'en') => list(store, null, locale),
    getPublic: (store, type, locale = 'en') => get(store, type, null, locale),
    list: (store, identity) => list(store, identity),
    getStaff: (store, identity, type) => get(store, type, identity),
    async update(store, identity, type, input) {
      checkStore(store); checkType(type);
      if (!object(input) || !Number.isSafeInteger(input.version) || input.version < 0) invalid();
      if (Object.keys(input).some(key => ['fixedFields', 'type', 'store', 'supportedFieldTypes'].includes(key))) invalid();
      return transaction(async session => {
        const actor = await staff(store, identity, session);
        const previous = await repository.find(store, type, session);
        if (!previous) throw new AppError(404, 'FORM_NOT_FOUND');
        if (input.version !== previous.version) throw new AppError(409, 'FORM_CONFLICT');
        const fields = {};
        if (Object.hasOwn(input, 'title')) fields.title = translations(input.title, previous.title, 150, true);
        if (Object.hasOwn(input, 'helpText')) fields.helpText = translations(input.helpText, previous.helpText, 2000, false);
        if (Object.hasOwn(input, 'isActive')) {
          if (typeof input.isActive !== 'boolean') invalid();
          fields.isActive = input.isActive;
        }
        if (Object.hasOwn(input, 'fields')) fields.fields = configurableFields(input.fields);
        if (!Object.keys(fields).length) invalid();
        const changed = await repository.update(store, type, previous.version, fields, session);
        if (!changed) throw new AppError(409, 'FORM_CONFLICT');
        await repository.audit({ store, actorId: actor._id, formType: type, action: 'updated',
          previousVersion: previous.version, version: changed.version, fields: Object.keys(fields) }, session);
        return view(changed);
      });
    },
  };
}
