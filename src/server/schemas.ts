import { z } from 'zod';
import { storeCopyKeys } from '../shared/i18n';
import { defaults, PRODUCT_DESCRIPTION_LIMIT } from '../shared/types';
const text = (max: number) => z.string().max(max);
const deadline = z.iso.datetime({ offset: true }).nullable().optional();
const socialUrl = z
  .string()
  .max(2000)
  .refine((v) => {
    if (!v) return true;
    try {
      const u = new URL(v);
      return u.protocol === 'https:' && !u.username && !u.password;
    } catch {
      return false;
    }
  }, 'استخدم رابط HTTPS صالحًا');
const language = z.enum(['ar', 'fr', 'en']);
const translatedProduct = z
  .object({
    name: text(150).optional(),
    keywords: text(1000).optional(),
    description: text(PRODUCT_DESCRIPTION_LIMIT).optional(),
    descriptionFormat: z.enum(['text', 'html']).optional(),
    descriptionHtml: text(PRODUCT_DESCRIPTION_LIMIT).optional(),
    deliveryReturns: text(10000).optional(),
  })
  .strict();
const color = z.string().regex(/^#[0-9a-fA-F]{6}$/);
const url = z
  .string()
  .max(2000)
  .refine(
    (v) =>
      !v ||
      (v.startsWith('/') && !v.startsWith('//')) ||
      /^https:\/\//.test(v) ||
      /^http:\/\/localhost(:\d+)?\//.test(v),
    'رابط غير صالح',
  );
export const cartSchema = z
  .array(
    z
      .object({
        productId: text(100),
        offerId: text(300),
        quantity: z.number().int().min(1).max(100),
        revision: z.number().int().min(1),
      })
      .strict(),
  )
  .min(1)
  .max(30);
export const customerSchema = z.object({
  name: text(120),
  phone: text(40),
  city: text(100),
  address: text(500),
  notes: text(500).default(''),
});
export const blockSchema = z.object({
  id: text(100),
  type: z.enum(['IMAGE', 'CTA', 'ORDER_FORM']),
  order: z.number().int().min(0),
  enabled: z.boolean(),
  settings: z
    .object({
      image: url.optional(),
      alt: text(250).optional(),
      width: z.number().int().positive().max(10000).optional(),
      height: z.number().int().positive().max(20000).optional(),
      text: text(200).optional(),
      color: color.optional(),
      textColor: color.optional(),
      size: z.number().min(12).max(40).optional(),
      margin: z.number().min(0).max(100).optional(),
      formTitle: text(200).optional(),
      formSubtitle: text(300).optional(),
      submitText: text(150).optional(),
      nameLabel: text(80).optional(),
      namePlaceholder: text(150).optional(),
      phoneLabel: text(80).optional(),
      phonePlaceholder: text(150).optional(),
      cityLabel: text(80).optional(),
      cityPlaceholder: text(150).optional(),
      addressLabel: text(80).optional(),
      addressPlaceholder: text(150).optional(),
      notesLabel: text(80).optional(),
      notesPlaceholder: text(150).optional(),
      showNotes: z.boolean().optional(),
    })
    .strict(),
});
export const offerSchema = z.object({
  id: text(100).refine(
    (v) => !v.startsWith('checkout:') && !v.startsWith('quantity:'),
    'معرف عرض محجوز',
  ),
  label: text(120),
  quantity: z.number().int().min(1).max(100),
  total: z.number().int().positive().max(100000000),
  freeShipping: z.boolean(),
  enabled: z.boolean().optional(),
  endsAt: deadline,
});
export const crossSellSchema = z
  .object({
    freeShipping: z.boolean().optional(),
    id: z.string().uuid(),
    title: text(120),
    items: z
      .array(
        z
          .object({
            productId: text(100),
            quantity: z.number().int().min(1).max(100),
            total: z.number().int().positive().max(100000000).optional(),
          })
          .strict(),
      )
      .min(1)
      .max(4),
    total: z.number().int().positive().max(100000000),
    enabled: z.boolean(),
    endsAt: deadline,
  })
  .strict();
export const productSchema = z.object({
  id: text(100),
  slug: z.string().regex(/^[a-z0-9][a-z0-9-]{0,99}$/),
  sku: text(100).min(1),
  name: text(150).min(2),
  description: text(PRODUCT_DESCRIPTION_LIMIT),
  image: url,
  price: z.number().int().positive().max(100000000),
  active: z.number().int().min(0).max(1),
  featured: z.number().int().min(0).max(1),
  offers: z.array(offerSchema).max(20),
  blocks: z.array(blockSchema).max(50),
  color,
  formColor: color,
  shippingCasa: z.number().int().min(0).max(100000).nullable().optional().default(null),
  shippingOther: z.number().int().min(0).max(100000).nullable().optional().default(null),
  categoryId: z.string().uuid().nullable().optional().default(null),
  pageMode: z.enum(['product', 'landing']).optional().default('product'),
  storefrontVisible: z.number().int().min(0).max(1).default(1),
  gallery: z.array(url).max(12).default([]),
  keywords: text(1000).default(''),
  presentation: z
    .object({
      freeShipping: z.boolean().optional(),
      bundleMode: z.boolean().optional(),
      bundleLabel: text(120).optional(),
      quantityPricing: z
        .object({
          unitPrice: z.number().int().positive().max(100000000),
          fromQuantity: z.number().int().min(2).max(101).optional(),
          freeShipping: z.boolean(),
          enabled: z.boolean().optional(),
          endsAt: deadline,
        })
        .strict()
        .optional(),
      crossSells: z.array(crossSellSchema).max(4).optional(),
      landingLanguage: language.optional(),
      contentLanguage: language.optional(),
      promotion: z
        .object({
          price: z.number().int().positive().max(100000000),
          endsAt: deadline,
          startsAt: deadline,
        })
        .strict()
        .nullable()
        .optional(),
      descriptionFormat: z.enum(['text', 'html']).optional(),
      descriptionHtml: text(PRODUCT_DESCRIPTION_LIMIT).optional(),
      deliveryReturns: text(10000).optional(),
      recommendationMode: z.enum(['auto', 'manual', 'hidden']).optional(),
      recommendedIds: z.array(z.string().max(100)).max(8).optional(),
      translations: z
        .object({
          ar: translatedProduct.optional(),
          fr: translatedProduct.optional(),
          en: translatedProduct.optional(),
        })
        .strict()
        .optional(),
    })
    .strict()
    .default({}),
});
export const categorySchema = z
  .object({
    id: z.string().uuid(),
    name: z.string().trim().min(2).max(80),
    image: url.default(''),
    icon: text(20).default('🛍️'),
    position: z.number().int().min(0).max(1000),
    active: z.number().int().min(0).max(1),
  })
  .strict();
const baseSettingsSchema = z
  .object({
    adminLanguage: language.default('ar'),
    storeLanguage: language.default('ar'),
    storeLanguages: z
      .array(language)
      .min(1)
      .max(3)
      .refine((values) => new Set(values).size === values.length, 'اختر لغات مختلفة.')
      .optional(),
    contentTranslations: z
      .object({
        ar: z.record(z.string().max(100), z.unknown()).optional(),
        fr: z.record(z.string().max(100), z.unknown()).optional(),
        en: z.record(z.string().max(100), z.unknown()).optional(),
      })
      .strict()
      .default({}),
    brand: text(100).min(1),
    whatsapp: z.string().regex(/^$|^\d{10,15}$/),
    contactEmail: z
      .string()
      .max(200)
      .refine((v) => !v || z.email().safeParse(v).success, 'بريد غير صالح')
      .default(''),
    contactPhone: z
      .string()
      .regex(/^$|^\+?[\d ()-]{8,25}$/)
      .default(''),
    socials: z
      .object({
        facebook: socialUrl.default(''),
        instagram: socialUrl.default(''),
        tiktok: socialUrl.default(''),
        youtube: socialUrl.default(''),
        linkedin: socialUrl.default(''),
        x: socialUrl.default(''),
        snapchat: socialUrl.default(''),
      })
      .strict()
      .default(defaults.socials),
    checkoutOffers: z
      .array(
        z
          .object({
            id: z.string().uuid(),
            productId: text(100),
            title: text(100),
            quantity: z.number().int().min(1).max(100),
            total: z.number().int().positive().max(10000000),
            enabled: z.boolean(),
            endsAt: deadline,
          })
          .strict(),
      )
      .max(8)
      .default([]),
    logo: url,
    favicon: url,
    announcement: text(300),
    heroTitle: text(300),
    heroText: text(1000),
    shippingCasa: z.number().int().min(0).max(100000),
    shippingOther: z.number().int().min(0).max(100000),
    cartFreeShippingThreshold: z.number().int().min(0).max(100000000).default(0),
    autoConfirm: z.boolean(),
    terms: text(10000),
    privacy: text(10000),
    returns: text(10000),
    contact: text(10000),
    facebookPixel: z.string().regex(/^\d{0,30}$/),
    tiktokPixel: z.string().regex(/^[a-zA-Z0-9]{0,60}$/),
    googleId: z.string().regex(/^$|^(G|GT|AW)-[A-Z0-9-]{3,40}$/),
    snapPixel: z.string().regex(/^[a-zA-Z0-9-]{0,60}$/),
    trackingEnabled: z.boolean(),
    turnstileSiteKey: text(100),
    supplierField: z.string().regex(/^$|^[a-zA-Z0-9_.]{1,100}$/),
    citiesField: z.string().regex(/^$|^[a-zA-Z0-9_.]{1,100}$/),
    cityNameField: z.string().regex(/^$|^[a-zA-Z0-9_.]{1,100}$/),
    contractVerified: z.boolean(),
    metaVersion: z
      .string()
      .regex(/^$|^v\d+\.\d+$/)
      .optional()
      .default(''),
    attributionDays: z.literal(30),
    theme: z
      .object({
        primary: color,
        background: color,
        surface: color,
        text: color,
        muted: color,
        accent: color,
        line: color,
      })
      .strict()
      .default(defaults.theme),
    home: z
      .object({
        tagline: text(150),
        heroEyebrow: text(150),
        heroImage: url,
        heroImageWidth: z.number().int().min(1).max(2000),
        heroImageHeight: z.number().int().min(1).max(16383),
        heroButtonText: text(100),
        heroProof: z.array(text(150)).max(6),
        showHero: z.boolean(),
        showBenefits: z.boolean(),
        benefits: z.array(text(150)).max(6),
        productsEyebrow: text(150),
        productsTitle: text(150),
        productTagline: text(150),
        featuredBadge: text(100),
        showPromise: z.boolean(),
        promiseEyebrow: text(150),
        promiseTitle: text(300),
        promiseCards: z.array(z.object({ title: text(100), text: text(500) }).strict()).max(6),
        footerText: text(500),
        emptyTitle: text(150),
        emptyText: text(500),
      })
      .strict()
      .default(defaults.home),
  })
  .strict();
const storeContentSchema = baseSettingsSchema
  .pick({
    announcement: true,
    heroTitle: true,
    heroText: true,
    terms: true,
    privacy: true,
    returns: true,
    contact: true,
  })
  .partial()
  .extend({
    home: baseSettingsSchema.shape.home.unwrap().partial().optional(),
    copy: z
      .record(
        z.string().refine((key) => storeCopyKeys.includes(key), 'Unknown interface phrase'),
        text(1000),
      )
      .optional(),
  })
  .strict();
export const settingsSchema = baseSettingsSchema
  .extend({
    contentTranslations: z
      .object({
        ar: storeContentSchema.optional(),
        fr: storeContentSchema.optional(),
        en: storeContentSchema.optional(),
      })
      .strict()
      .default({}),
  })
  .superRefine((s, context) => {
    if (s.storeLanguages && !s.storeLanguages.includes(s.storeLanguage))
      context.addIssue({
        code: 'custom',
        path: ['storeLanguage'],
        message: 'اختر لغة افتراضية من اللغات المفعّلة.',
      });
  });
export const attributionSchema = z
  .object({
    first: z.record(z.string(), text(500)).optional(),
    last: z.record(z.string(), text(500)).optional(),
  })
  .default({});
export const orderSchema = z.object({
  cart: cartSchema,
  customer: customerSchema,
  fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  idempotency: z.string().uuid(),
  attribution: attributionSchema,
  matching: z
    .object({
      fbp: text(200).optional(),
      fbc: text(500).optional(),
      consent: z.boolean().optional(),
    })
    .default({}),
  turnstileToken: text(4096).default(''),
  checkoutMode: z.enum(['cart', 'direct']).default('cart'),
});
