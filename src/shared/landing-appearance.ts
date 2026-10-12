import { defaults, type LandingFormAppearance, type Product, type Settings } from './types';

export const landingAppearanceLabels: Record<keyof LandingFormAppearance, string> = {
  background: 'خلفية منطقة الطلب',
  surface: 'خلفية الاستمارة والملخص والباقات',
  text: 'لون العناوين والنصوص',
  muted: 'لون النصوص الثانوية',
  fieldBackground: 'خلفية الخانات',
  fieldText: 'لون النص داخل الخانات',
  placeholder: 'لون النص الإرشادي داخل الخانات',
  border: 'لون حدود الخانات والبطاقات',
  accent: 'لون تحديد الباقة المختارة',
  buttonBackground: 'خلفية زر تأكيد الطلب',
  buttonText: 'لون نص زر تأكيد الطلب',
};

/** Old formColor belongs to the landing form; ordinary checkout uses the store theme. */
export function landingFormAppearance(p: Product, s: Settings): LandingFormAppearance {
  const theme = { ...defaults.theme, ...s.theme };
  return {
    background: p.formColor && p.formColor !== '#f3f0e9' ? p.formColor : theme.background,
    surface: theme.surface,
    text: theme.text,
    muted: theme.muted,
    fieldBackground: theme.surface,
    fieldText: theme.text,
    placeholder: theme.muted,
    border: theme.line,
    accent: theme.primary,
    buttonBackground: theme.primary,
    buttonText: '#ffffff',
    ...p.presentation?.landingFormAppearance,
  };
}
