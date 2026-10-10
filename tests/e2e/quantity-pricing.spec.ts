import { test, expect } from '@playwright/test';
const origin = 'http://localhost:8788';
test('quantity changes apply exact tiers and the higher-quantity price in product, basket and checkout', async ({
  page,
}) => {
  const login = await page.request.post('/api/auth/login', {
    headers: { Origin: origin, 'CF-Connecting-IP': '198.18.70.1' },
    data: { email: 'owner@example.test', password: 'local-admin-test-password-2026' },
  });
  expect(login.ok()).toBe(true);
  const headers = { Origin: origin, 'X-CSRF-Token': (await login.json()).csrf };
  const products = await (await page.request.get('/api/admin/products')).json();
  const bag = products.find((p: any) => p.id === 'demo-bag');
  try {
    const response = await page.request.put('/api/admin/products/' + bag.id, {
      headers,
      data: {
        ...bag,
        offers: [
          {
            id: 'quantity-two',
            label: 'الكمية 2 بسعر خاص',
            quantity: 2,
            total: 26000,
            freeShipping: true,
          },
        ],
        presentation: {
          ...bag.presentation,
          promotion: undefined,
          freeShipping: false,
          quantityPricing: { unitPrice: 12000, freeShipping: true, enabled: true },
        },
      },
    });
    expect(response.ok()).toBe(true);
    await page.goto('/shop/daily-bag');
    await expect(page.locator('#product-quantity')).toBeVisible();
    await page.locator('#product-quantity').fill('2');
    await expect(page.locator('.product-price-line')).toContainText('260');
    await expect(page.locator('input[name=offer][value=quantity-two]')).toBeChecked();
    await page.locator('#buy-now').click();
    await expect(page.locator('#subtotal')).toContainText('260');
    await expect(page.locator('#total')).toContainText('260');
    await page.locator('[data-direct-quantity][data-change="1"]').click();
    await expect(page.locator('#subtotal')).toContainText('360');
    await expect(page.locator('#total')).toContainText('360');
    await page.locator('[data-direct-quantity][data-change="1"]').click();
    await expect(page.locator('#subtotal')).toContainText('480');
    await expect(page.locator('#total')).toContainText('480');
    for (let i = 0; i < 3; i++)
      await page.locator('[data-direct-quantity][data-change="-1"]').click();
    await expect(page.locator('#subtotal')).toContainText('149');
    await expect(page.locator('#total')).toContainText('179');
    await page.goto('/shop/daily-bag');
    await page.locator('#product-quantity').fill('2');
    await page.locator('#add-offer').click();
    await page.goto('/checkout');
    await expect(page.locator('#subtotal')).toContainText('260');
    await page.locator('#checkout-items [data-quantity][data-change="1"]').click();
    await expect(page.locator('#subtotal')).toContainText('360');
    await expect(page.locator('#total')).toContainText('360');
    const current = (await (await page.request.get('/api/products')).json()).find(
      (p: any) => p.id === bag.id,
    );
    const quote = await page.request.post('/api/checkout/quote', {
      headers: { Origin: origin },
      data: {
        cart: [{ productId: bag.id, offerId: '', quantity: 4, revision: current.revision }],
        city: 'Rabat',
      },
    });
    expect(quote.ok()).toBe(true);
    expect(await quote.json()).toMatchObject({
      total: 48000,
      shipping: 0,
      items: [{ quantity: 4, subtotal: 48000, offerId: 'quantity:more' }],
    });
  } finally {
    await page.request.put('/api/admin/products/' + bag.id, { headers, data: bag });
  }
});
