export const formTypes = ['spinning', 'weaving', 'fabric', 'school-uniforms', 'wholesale'];
export const fieldTypes = ['text', 'textarea', 'number', 'select', 'multiselect', 'boolean'];
export const initialTitles = {
  spinning: { ar: 'الغزل', en: 'Spinning' },
  weaving: { ar: 'النسيج', en: 'Weaving' },
  fabric: { ar: 'الأقمشة', en: 'Fabric' },
  'school-uniforms': { ar: 'الزي المدرسي', en: 'School Uniforms' },
  wholesale: { ar: 'الجملة', en: 'Wholesale' },
};
export const fixedFields = [
  { key: 'name', type: 'text', label: { ar: 'الاسم', en: 'Name' }, required: true, constraints: { minLength: 1, maxLength: 100 } },
  { key: 'phone', type: 'phone', label: { ar: 'رقم الهاتف', en: 'Phone' }, required: true, constraints: { maxLength: 32 } },
  { key: 'email', type: 'email', label: { ar: 'البريد الإلكتروني', en: 'Email' }, required: false, constraints: { maxLength: 254 } },
  { key: 'governorate', type: 'text', label: { ar: 'المحافظة', en: 'Governorate' }, required: true, constraints: { minLength: 1, maxLength: 150 } },
  { key: 'district', type: 'text', label: { ar: 'المنطقة / الحي', en: 'District / area' }, required: true, constraints: { minLength: 1, maxLength: 150 } },
];
export const fieldConstraints = {
  text: { minLength: 1, maxLength: 500 },
  textarea: { minLength: 1, maxLength: 5000 },
  number: { min: -1000000000, max: 1000000000 },
  select: {},
  multiselect: { minItems: 1, maxItems: 50, uniqueItems: true },
  boolean: {},
};
