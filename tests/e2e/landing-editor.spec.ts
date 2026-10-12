import { test, expect, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
const origin = 'http://localhost:8788';
async function owner(page: Page) {
  const account = { email: 'owner@example.test', password: 'local-admin-test-password-2026' };
  const status = await (await page.request.get('/api/auth/status')).json();
  if (status.setup) {
    const vars = await readFile('.dev.vars', 'utf8');
    expect(
      (
        await page.request.post('/api/auth/setup', {
          headers: { Origin: origin },
          data: { ...account, token: vars.match(/^SETUP_TOKEN=(.+)$/m)![1] },
        })
      ).ok(),
    ).toBe(true);
  }
  const login = await page.request.post('/api/auth/login', {
    headers: { Origin: origin, 'CF-Connecting-IP': '198.18.74.1' },
    data: account,
  });
  expect(login.ok()).toBe(true);
  return { Origin: origin, 'X-CSRF-Token': (await login.json()).csrf };
}
async function edit(page: Page, sku: string) {
  await page.goto('/admin/products');
  await page
    .locator('tbody tr')
    .filter({ hasText: sku })
    .getByRole('button', { name: 'تعديل', exact: true })
    .click();
}

test('landing editor uploads images and edits buttons and language while retaining a regular primary product page', async ({
  page,
}) => {
  const headers = await owner(page);
  const original = (await (await page.request.get('/api/admin/products')).json()).find(
    (p: any) => p.id === 'demo-bag',
  );
  let media = '';
  try {
    expect(
      (
        await page.request.put('/api/admin/products/' + original.id, {
          headers,
          data: { ...original, pageMode: 'product', blocks: [] },
        })
      ).ok(),
    ).toBe(true);
    await edit(page, original.sku);
    await expect(page.getByLabel('طريقة عرض المنتج', { exact: true })).toHaveValue('product');
    await page.getByRole('button', { name: 'تعديل صفحة الهبوط', exact: true }).click();
    const editor = page.locator('.product-customization');
    await expect(editor.getByLabel('لغة اللاندينج باج', { exact: true })).toBeVisible();
    expect(
      await page.locator('.product-optional-section').getByLabel('لغة اللاندينج باج').count(),
    ).toBe(0);
    await editor.getByLabel('لغة اللاندينج باج', { exact: true }).selectOption('fr');
    await editor.getByRole('button', { name: 'صورة +', exact: true }).click();
    const imageBlock = editor.locator('.editor-block').first();
    const png = await page.evaluate(() => {
      const c = document.createElement('canvas');
      c.width = 900;
      c.height = 1800;
      const ctx = c.getContext('2d')!;
      ctx.fillStyle = '#e8eddb';
      ctx.fillRect(0, 0, 900, 1800);
      ctx.fillStyle = '#173d35';
      ctx.fillRect(50, 50, 800, 700);
      return c.toDataURL('image/png').split(',')[1];
    });
    const uploaded = page.waitForResponse(
      (r) => r.url().endsWith('/api/admin/media') && r.request().method() === 'POST',
    );
    await imageBlock.locator('input[type=file]').setInputFiles({
      name: 'landing-test.png',
      mimeType: 'image/png',
      buffer: Buffer.from(png, 'base64'),
    });
    const response = await uploaded;
    expect(response.ok()).toBe(true);
    media = (await response.json()).url;
    await expect(imageBlock.getByLabel('رابط الصورة', { exact: true })).toHaveValue(media);
    await editor.getByRole('button', { name: 'زر +', exact: true }).click();
    await editor.getByLabel('نص الزر', { exact: true }).fill('Commander maintenant');
    await editor.getByRole('button', { name: 'استمارة +', exact: true }).click();
    await editor.getByRole('button', { name: 'معاينة صفحة الهبوط', exact: true }).click();
    const preview = page.frameLocator('iframe[title="معاينة صفحة المنتج"]');
    await expect(preview.locator('html')).toHaveAttribute('lang', 'fr');
    await expect(preview.locator('img.image-slice')).toHaveCount(1);
    await expect(
      preview.getByRole('link', { name: 'Commander maintenant', exact: true }),
    ).toBeVisible();
    await expect(preview.locator('#checkout-form')).toBeVisible();
    await expect(page.getByLabel('طريقة عرض المنتج', { exact: true })).toHaveValue('product');
    await page.getByRole('button', { name: 'حفظ المنتج', exact: true }).click();
    await expect(page.getByRole('status')).toContainText('تم حفظ المنتج.');
    const saved = (await (await page.request.get('/api/admin/products')).json()).find(
      (p: any) => p.id === original.id,
    );
    expect(saved.pageMode).toBe('product');
    expect(saved.presentation.landingLanguage).toBe('fr');
    expect(saved.blocks.map((b: any) => b.type)).toEqual(['IMAGE', 'CTA', 'ORDER_FORM']);
    const protectedImage = await page.request.delete('/api/admin/media/' + media.split('/').pop(), {
      headers,
    });
    expect(protectedImage.status()).toBe(400);
    expect((await protectedImage.json()).error).toBe('media_in_use');
    await page.goto('/shop/' + saved.slug);
    await expect(page.locator('.image-slice')).toHaveCount(0);
    await page.goto('/offers/' + saved.slug);
    await expect(page.locator('html')).toHaveAttribute('lang', 'fr');
    await expect(page.locator('img.image-slice')).toHaveAttribute('src', media);
    await expect
      .poll(() =>
        page
          .locator('img.image-slice')
          .evaluate((img: HTMLImageElement) => img.naturalHeight > img.naturalWidth),
      )
      .toBe(true);
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 1000 });
      await page.getByRole('link', { name: 'Commander maintenant', exact: true }).click();
      await expect(page.locator('#checkout-form')).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
      await page.screenshot({
        path: 'test-results/landing-editor-' + width + '.png',
        fullPage: true,
      });
    }
    await edit(page, original.sku);
    await page.getByRole('button', { name: 'تعديل صفحة الهبوط', exact: true }).click();
    await expect(
      page.locator('.product-customization').getByLabel('رابط الصورة', { exact: true }),
    ).toHaveValue(media);
  } finally {
    expect(
      (
        await page.request.put('/api/admin/products/' + original.id, { headers, data: original })
      ).ok(),
    ).toBe(true);
    if (media)
      expect(
        (await page.request.delete('/api/admin/media/' + media.split('/').pop(), { headers })).ok(),
      ).toBe(true);
  }
});

test('featured products get their badge and priority, and bundle profit shows the complete quantity', async ({
  page,
}) => {
  const headers = await owner(page);
  const rows = await (await page.request.get('/api/admin/products')).json();
  const bag = rows.find((p: any) => p.id === 'demo-bag'),
    candle = rows.find((p: any) => p.id === 'demo-candle');
  try {
    for (const product of [bag, candle])
      expect(
        (
          await page.request.put('/api/admin/products/' + product.id, {
            headers,
            data: { ...product, featured: 0 },
          })
        ).ok(),
      ).toBe(true);
    await edit(page, candle.sku);
    await page.getByRole('button', { name: 'طي جميع الأقسام', exact: true }).click();
    await page.getByRole('button', { name: 'فتح جميع الأقسام', exact: true }).click();
    await page.getByLabel('منتج مميز', { exact: true }).check();
    await page.getByRole('button', { name: 'حفظ المنتج', exact: true }).click();
    await expect(page.getByRole('status')).toContainText('تم حفظ المنتج.');
    await page.goto('/');
    const card = page.locator('[data-product-card="demo-candle"]');
    await expect(card.locator('.product-badge')).toBeVisible();
    const order = await page
      .locator('[data-product-card]')
      .evaluateAll((els) => els.map((el) => el.getAttribute('data-product-card')));
    expect(order.indexOf(candle.id)).toBeLessThan(order.indexOf(bag.id));
    await edit(page, bag.sku);
    await page.getByLabel('السعر الأصلي بالدرهم', { exact: true }).fill('160');
    await page.getByLabel('بيع المنتج بالباقات', { exact: true }).check();
    const bundle = page.locator('.bundle-edit-row').first();
    await bundle.getByLabel('الكمية', { exact: true }).fill('2');
    await bundle.getByLabel('سعر الباقة بالدرهم', { exact: true }).fill('280');
    await bundle.getByRole('combobox').selectOption('inherit');
    await expect(bundle.locator('.profit-line')).toContainText(
      'إجمالي الربح الصافي للباقة (تقريبي)',
    );
    await expect(bundle.locator('.profit-line strong')).toContainText('120');
    await expect(bundle.locator('.profit-scope')).toContainText('2');
    await bundle.getByLabel('الكمية', { exact: true }).fill('3');
    await expect(bundle.locator('.profit-line strong')).toContainText('40');
    await bundle.getByRole('combobox').selectOption('free');
    await expect(bundle.locator('.profit-line strong')).toContainText('10');
  } finally {
    for (const product of [bag, candle])
      expect(
        (
          await page.request.put('/api/admin/products/' + product.id, { headers, data: product })
        ).ok(),
      ).toBe(true);
  }
});
