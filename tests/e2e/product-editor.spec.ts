import { test, expect, type Page } from '@playwright/test';
test.use({ actionTimeout: 7000 });
const origin = 'http://localhost:8788';
async function owner(page: Page, ip: string) {
  const response = await page.request.post('/api/auth/login', {
    headers: { Origin: origin, 'CF-Connecting-IP': ip },
    data: { email: 'owner@example.test', password: 'local-admin-test-password-2026' },
  });
  expect(response.ok()).toBe(true);
  return { Origin: origin, 'X-CSRF-Token': (await response.json()).csrf };
}
async function editBag(page: Page) {
  await page.goto('/admin/products');
  await page
    .locator('tbody tr')
    .filter({ hasText: 'DEMO-A1' })
    .getByRole('button', { name: 'تعديل', exact: true })
    .click();
}
test('settings saving prevents duplicate requests and brings its confirmation into view', async ({
  page,
}) => {
  const headers = await owner(page, '198.18.14.1');
  const original = (await (await page.request.get('/api/admin/settings')).json()).settings;
  let writes = 0;
  await page.route('**/api/admin/settings', async (route) => {
    if (route.request().method() !== 'PUT') return route.continue();
    writes++;
    const response = await route.fetch();
    await new Promise((resolve) => setTimeout(resolve, 350));
    await route.fulfill({ response });
  });
  try {
    await page.goto('/admin/appearance');
    const save = page.getByRole('button', { name: 'حفظ الإعدادات', exact: true });
    await save.scrollIntoViewIfNeeded();
    expect(await page.evaluate(() => scrollY)).toBeGreaterThan(300);
    await save.click();
    await expect(page.getByRole('button', { name: 'جارٍ الحفظ…', exact: true })).toBeDisabled();
    await expect(
      page.getByRole('status').filter({ hasText: 'تم حفظ التغييرات.' }),
    ).toBeInViewport();
    expect(writes).toBe(1);
    expect(await page.evaluate(() => scrollY)).toBeLessThan(100);
  } finally {
    await page.unroute('**/api/admin/settings');
    await page.request.put('/api/admin/settings', { headers, data: original });
  }
});
test('supplier text or HTML can be imported and formatted descriptions are safe in previews and public pages', async ({
  page,
}) => {
  const headers = await owner(page, '198.18.14.2');
  const original = (await (await page.request.get('/api/admin/products')).json()).find(
    (p: any) => p.id === 'demo-bag',
  );
  const html =
    '<div dir="rtl"><h2>تفاصيل منسقة</h2><p>محتوى <strong>مهم</strong></p><ul><li>ميزة عملية</li></ul><img src="https://catalog-images.example.test/detail.svg" onerror="window.unsafeDescription=true"><script>window.unsafeDescription=true</script></div>';
  await page.route('**/api/admin/catalog*', async (route) => {
    const response = await route.fetch(),
      body = await response.json();
    const change = (c: any) => ({
      ...c,
      description: html,
      keywords: ['sac', 'voyage'],
      stock_quantity: 997,
    });
    await route.fulfill({
      response,
      json: Array.isArray(body)
        ? body.map(change)
        : { ...body, products: body.products.map(change) },
    });
  });
  await page.route('https://catalog-images.example.test/**', (route) =>
    route.fulfill({
      contentType: 'image/svg+xml',
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128"><rect width="128" height="128" fill="green"/></svg>',
    }),
  );
  try {
    await editBag(page);
    await page.getByRole('button', { name: 'طي جميع الأقسام', exact: true }).click();
    await page.getByRole('button', { name: 'فتح جميع الأقسام', exact: true }).click();
    await page.getByLabel('نوع الوصف المستورد من مورد', { exact: true }).selectOption('text');
    await page.getByRole('button', { name: 'اختيار حقيبة يومية أنيقة', exact: true }).click();
    await expect(page.getByLabel('الوصف', { exact: true })).toHaveValue(
      'تفاصيل منسقة\nمحتوى مهم\nميزة عملية',
    );
    await expect(page.getByLabel('كلمات مفتاحية (اختياري)', { exact: true })).toHaveValue(
      'sac, voyage',
    );
    await expect(page.locator('.catalog-grid').first()).not.toContainText('997');
    await page.getByLabel('نوع الوصف المستورد من مورد', { exact: true }).selectOption('html');
    await page.getByRole('button', { name: 'استيراد الوصف من مورد', exact: true }).click();
    await page.getByRole('button', { name: 'كود HTML', exact: true }).first().click();
    await expect(page.getByLabel('الوصف', { exact: true })).toHaveValue(html);
    await page.getByRole('button', { name: 'معاينة المسودة', exact: true }).click();
    const preview = page.frameLocator('iframe[title="معاينة صفحة المنتج"]');
    await expect(preview.locator('.formatted-description h2')).toHaveText('تفاصيل منسقة');
    await expect(preview.locator('.formatted-description strong')).toHaveText('مهم');
    await expect(preview.locator('.formatted-description script')).toHaveCount(0);
    await expect(preview.locator('.formatted-description [onerror]')).toHaveCount(0);
    await page.getByRole('button', { name: 'حفظ المنتج', exact: true }).click();
    await expect(page.getByRole('status')).toContainText('تم حفظ المنتج.');
    const saved = (await (await page.request.get('/api/admin/products')).json()).find(
      (p: any) => p.id === original.id,
    );
    expect(saved.description).toBe('تفاصيل منسقة\nمحتوى مهم\nميزة عملية');
    expect(saved.presentation.descriptionHtml).not.toContain('script');
    await page.goto('/shop/' + original.slug);
    await expect(page.locator('.formatted-description img')).toHaveJSProperty('naturalWidth', 128);
    expect(await page.evaluate(() => (window as any).unsafeDescription)).toBeUndefined();
    const search = await (
      await page.request.get('/api/products?q=' + encodeURIComponent('ميزة عملية'))
    ).json();
    expect(search.some((p: any) => p.id === original.id)).toBe(true);
  } finally {
    await page.request.put('/api/admin/products/' + original.id, { headers, data: original });
  }
});
test('a gallery thumbnail becomes the main image without losing the previous photo', async ({
  page,
}) => {
  const headers = await owner(page, '198.18.14.3');
  const original = (await (await page.request.get('/api/admin/products')).json()).find(
    (p: any) => p.id === 'demo-bag',
  );
  try {
    expect(
      (
        await page.request.put('/api/admin/products/' + original.id, {
          headers,
          data: { ...original, gallery: ['/demo/notebook.svg', '/demo/candle.svg'] },
        })
      ).ok(),
    ).toBe(true);
    await editBag(page);
    await page.getByRole('button', { name: 'طي جميع الأقسام', exact: true }).click();
    await page.getByRole('button', { name: 'فتح جميع الأقسام', exact: true }).click();
    const photo = page
      .locator('.gallery-editor-row')
      .filter({ has: page.locator('img[src="/demo/notebook.svg"]') });
    await photo.getByRole('button', { name: 'تعيين كصورة رئيسية', exact: true }).click();
    await expect(
      photo.getByRole('button', { name: 'الصورة الرئيسية', exact: true }),
    ).toHaveAttribute('aria-pressed', 'true');
    await page.getByRole('button', { name: 'حفظ المنتج', exact: true }).click();
    await expect(page.getByRole('status')).toContainText('تم حفظ المنتج.');
    const saved = (await (await page.request.get('/api/admin/products')).json()).find(
      (p: any) => p.id === original.id,
    );
    expect(saved.image).toBe('/demo/notebook.svg');
    expect(saved.gallery).toContain(original.image);
    await page.goto('/shop/' + original.slug);
    await expect(page.locator('#product-main-image')).toHaveAttribute('src', '/demo/notebook.svg');
    await expect(page.locator('[data-gallery-image="' + original.image + '"]')).toHaveCount(1);
  } finally {
    await page.request.put('/api/admin/products/' + original.id, { headers, data: original });
  }
});
test('manual recommendations show catalog photos and import a new product only after its price is confirmed', async ({
  page,
}) => {
  const headers = await owner(page, '198.18.14.4');
  const original = (await (await page.request.get('/api/admin/products')).json()).find(
    (p: any) => p.id === 'demo-bag',
  );
  let imported: any;
  await page.route('https://catalog-images.example.test/**', (route) =>
    route.fulfill({
      contentType: 'image/svg+xml',
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128"><rect width="128" height="128" fill="green"/></svg>',
    }),
  );
  try {
    await editBag(page);
    await page.getByRole('button', { name: 'طي جميع الأقسام', exact: true }).click();
    await page.getByRole('button', { name: 'فتح جميع الأقسام', exact: true }).click();
    await page.getByLabel('طريقة اختيار المنتجات المقترحة', { exact: true }).selectOption('manual');
    const card = page.getByRole('button', { name: 'اقتراح حافظة للبطاقات', exact: true });
    await expect(card.locator('img')).toHaveJSProperty('naturalWidth', 128);
    await expect(card).not.toContainText('997');
    await expect(
      page.getByRole('button', { name: 'اقتراح شمعة بلحظات هادئة', exact: true }),
    ).toBeDisabled();
    const before = await (await page.request.get('/api/admin/products')).json();
    expect(before.some((p: any) => p.sku === 'DEMO-A3')).toBe(false);
    await card.click();
    await expect(
      page.getByLabel('سعر بيع المنتج المقترح بالدرهم', { exact: true }),
    ).toBeInViewport();
    await page.getByLabel('سعر بيع المنتج المقترح بالدرهم', { exact: true }).fill('95');
    await page.getByRole('button', { name: 'نشر المنتج وإضافته للمقترحات', exact: true }).click();
    await expect(page.getByRole('status')).toContainText('تم نشر المنتج واختياره للمقترحات.');
    imported = (await (await page.request.get('/api/admin/products')).json()).find(
      (p: any) => p.sku === 'DEMO-A3',
    );
    expect(imported.active).toBe(1);
    expect(imported.price).toBe(9500);
    await expect(page.locator('.selected-recommendations')).toContainText('حافظة للبطاقات');
    await page.getByRole('button', { name: 'حفظ المنتج', exact: true }).click();
    await expect(page.getByRole('status')).toContainText('تم حفظ المنتج.');
    await page.goto('/shop/' + original.slug);
    await expect(page.locator('[data-related-products] [data-product-card]')).toHaveAttribute(
      'data-product-card',
      imported.id,
    );
  } finally {
    await page.request.put('/api/admin/products/' + original.id, { headers, data: original });
    if (imported)
      await page.request.put('/api/admin/products/' + imported.id, {
        headers,
        data: { ...imported, active: 0, storefrontVisible: 0 },
      });
  }
});
