import { createHash } from 'node:crypto';

const definitions = {
  b2c: [
    ['hero-left', 'Hero: left image', 'الصورة اليسرى للبنر الرئيسي'],
    ['hero-right', 'Hero: right image', 'الصورة اليمنى للبنر الرئيسي'],
    ['collection-men', 'Men collection', 'مجموعة الرجال'],
    ['collection-women', 'Women collection', 'مجموعة النساء'],
    ['sale-feature', 'Sale feature', 'صورة قسم التخفيضات'],
    ['factory-story', 'Factory story', 'صورة قصة المصنع'],
  ],
  b2b: [
    ['hero', 'Main banner', 'البنر الرئيسي'],
    ['service-spinning', 'Spinning service', 'خدمة الغزل'],
    ['service-weaving', 'Weaving service', 'خدمة النسيج'],
    ['service-fabric', 'Fabric service', 'خدمة الأقمشة'],
    ['service-school-uniforms', 'School uniforms service', 'خدمة الزي المدرسي'],
    ['service-wholesale', 'Wholesale service', 'خدمة الجملة'],
    ['wholesale-overview', 'Wholesale overview', 'صورة نظرة عامة على الجملة'],
  ],
};
export const homepageSlots = store => definitions[store].map(([key, en, ar]) => ({ key, label: { en, ar }, supportsMobileImage: true }));
export const homepageTargetId = (store, key) => createHash('sha256').update(`narmer:homepage:${store}:${key}`).digest('hex').slice(0, 24);
