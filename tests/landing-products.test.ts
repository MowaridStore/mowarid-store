import { describe, it, expect } from 'vitest';
import { landingProducts, landingPackSavings } from '../src/shared/landing-products';
import { productSchema } from '../src/server/schemas';
import { type Product, defaults } from '../src/shared/types';
import { OrderForm } from '../src/server/views';
const product = (id: string, changes: Partial<Product> = {}) =>
  ({
    id,
    sku: id,
    name: id,
    price: 10000,
    offers: [],
    blocks: [],
    active: 1,
    verified: 1,
    supplier: 'supplier',
    stock: 20,
    revision: 1,
    pageMode: 'product',
    presentation: {},
    ...changes,
  }) as Product;
const a = product('pack', {
  price: 17000,
  pageMode: 'landing',
  presentation: {
    landingProductIds: ['one', 'two', 'draft', 'empty', 'unverified', 'one'],
    landingPackComponentIds: ['one', 'two'],
  },
});
const rows = [
  product('one'),
  product('two'),
  product('draft', { active: 0 }),
  product('empty', { stock: 0 }),
  product('unverified', { verified: 0 }),
  product('unselected'),
];
describe('landing purchase alternatives', () => {
  it('includes only explicitly selected available published SKUs, including products hidden from storefront', () => {
    expect(landingProducts(a, rows).map((p) => p.id)).toEqual(['pack', 'one', 'two']);
    expect(landingProducts(a, [product('one', { storefrontVisible: 0 })]).map((p) => p.id)).toEqual(
      ['pack', 'one'],
    );
    expect(landingProducts(product('plain'), rows)).toHaveLength(1);
  });
  it('computes savings from current component prices only with explicit complete pack composition', () => {
    expect(landingPackSavings(a, rows)).toBe(3000);
    expect(
      landingPackSavings(
        { ...a, presentation: { ...a.presentation, landingPackComponentIds: undefined } },
        rows,
      ),
    ).toBe(0);
    expect(
      landingPackSavings(
        a,
        rows.filter((p) => p.id !== 'two'),
      ),
    ).toBe(0);
    expect(
      landingPackSavings(a, [
        product('one', { presentation: { promotion: { price: 6000 } } }),
        product('two'),
      ]),
    ).toBe(0);
    expect(
      landingPackSavings(a, [
        product('one'),
        product('two', { presentation: { promotion: { price: 8000 } } }),
      ]),
    ).toBe(1000);
    expect(
      landingPackSavings(
        {
          ...a,
          presentation: { ...a.presentation, landingPackComponentIds: ['one', 'unselected'] },
        },
        rows,
      ),
    ).toBe(0);
  });
  it('validates bounded selections and escaped badge text without changing regular checkout', async () => {
    expect(
      productSchema.shape.presentation.safeParse({ landingProductIds: Array(7).fill('one') })
        .success,
    ).toBe(false);
    const p = {
      ...a,
      presentation: { ...a.presentation, landingCodBadge: { visible: false, text: 'custom' } },
    };
    const hidden = await OrderForm({ p, s: defaults, choices: rows }).toString();
    expect(hidden).not.toContain('class="cod-badge"');
    expect(hidden).toContain('name="landing-product"');
    expect(hidden).not.toContain('value="draft"');
    const custom = await OrderForm({
      p: {
        ...p,
        presentation: { ...p.presentation, landingCodBadge: { text: '<script>x</script>' } },
      },
      s: defaults,
    }).toString();
    expect(custom).toContain('&lt;script&gt;');
    const regular = await OrderForm({ p: { ...p, pageMode: 'product' }, s: defaults }).toString();
    expect(regular).toContain('الدفع عند الاستلام ✓');
    expect(regular).not.toContain('name="landing-product"');
  });
});
