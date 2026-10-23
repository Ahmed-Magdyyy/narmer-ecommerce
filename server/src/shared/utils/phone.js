export const normalizePhone = value => value.replace(/[ ()-]/g, '');
export const validPhone = value => /^\+?\d{6,15}$/.test(value);
