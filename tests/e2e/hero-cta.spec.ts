import { test, expect, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
const origin = 'http://localhost:8788';
async function owner(page: Page) {
  const account = { email: 'owner@example.test', password: 'local-admin-test-password-2026' };
  if ((await (await page.request.get('/api/auth/status')).json()).setup) {
    const token = (await readFile('.dev.vars', 'utf8')).match(/^SETUP_TOKEN=(.+)$/m)![1];
    expect(
      (
        await page.request.post('/api/auth/setup', {
          headers: { Origin: origin },
          data: { ...account, token },
        })
      ).ok(),
    ).toBe(true);
  }
  const login = await page.request.post('/api/auth/login', {
    headers: { Origin: origin, 'CF-Connecting-IP': '198.18.96.1' },
    data: account,
  });
  expect(login.ok()).toBe(true);
  return { Origin: origin, 'X-CSRF-Token': (await login.json()).csrf };
}
test('both homepage cards can be uploaded, saved, kept through cart filtering and reset independently', async ({
  page,
}) => {
  const headers = await owner(page),
    original = (await (await page.request.get('/api/admin/settings')).json()).settings;
  const images: string[] = [];
  try {
    await page.goto('/admin/appearance');
    const png = await page.evaluate(() => {
      const c = document.createElement('canvas');
      c.width = 80;
      c.height = 80;
      const g = c.getContext('2d')!;
      g.fillStyle = '#e8b4ca';
      g.fillRect(0, 0, 80, 80);
      return c.toDataURL('image/png').split(',')[1];
    });
    for (const [index, label] of ['تغيير الصورة الأولى', 'تغيير الصورة الثانية'].entries()) {
      await page.getByLabel(label, { exact: true }).setInputFiles({
        name: 'hero-' + index + '.png',
        mimeType: 'image/png',
        buffer: Buffer.from(png, 'base64'),
      });
      const image = page.locator('.hero-card-setting').nth(index).locator('img');
      await expect(image).toBeVisible();
      images.push((await image.getAttribute('src'))!);
    }
    await page.getByRole('button', { name: 'حفظ الإعدادات', exact: true }).click();
    await expect(page.getByText('تم حفظ التغييرات.', { exact: true })).toBeVisible();
    const saved = (await (await page.request.get('/api/admin/settings')).json()).settings;
    expect(saved.home.heroCardImages).toEqual(images);
    const legacy = structuredClone(saved);
    delete legacy.home.heroCardImages;
    expect((await page.request.put('/api/admin/settings', { headers, data: legacy })).ok()).toBe(
      true,
    );
    expect(
      (await (await page.request.get('/api/admin/settings')).json()).settings.home.heroCardImages,
    ).toEqual(images);
    for (const query of ['', '?lang=fr']) {
      await page.goto('/' + query);
      await expect(page.locator('[data-hero-product]')).toHaveCount(2);
      for (const index of [0, 1])
        await expect(page.locator(`[data-hero-index="${index}"] img`)).toHaveAttribute(
          'src',
          images[index],
        );
    }
    await page.goto('/');
    await page.locator('[data-add-product="demo-candle"]').click();
    for (const index of [0, 1]) {
      await expect(page.locator(`[data-hero-index="${index}"]`)).toBeVisible();
      await expect(page.locator(`[data-hero-index="${index}"] img`)).toHaveAttribute(
        'src',
        images[index],
      );
    }
    await page.goto('/admin/appearance');
    await page
      .locator('.hero-card-setting')
      .first()
      .getByRole('button', { name: 'استخدام صورة المنتج تلقائيًا', exact: true })
      .click();
    await page.getByRole('button', { name: 'حفظ الإعدادات', exact: true }).click();
    await expect(page.getByText('تم حفظ التغييرات.', { exact: true })).toBeVisible();
    await page.goto('/');
    await expect(page.locator('[data-hero-index="0"]')).not.toHaveAttribute(
      'data-hero-custom',
      'true',
    );
    await expect(page.locator('[data-hero-index="1"] img')).toHaveAttribute('src', images[1]);
  } finally {
    await page.request.put('/api/admin/settings', { headers, data: original });
    for (const image of images)
      await page.request.delete('/api/admin/media/' + image.split('/').pop(), { headers });
  }
});
test('CTA background can be edited beside its existing controls, previewed, saved, and reset independently', async ({
  page,
}) => {
  const headers = await owner(page),
    original = (await (await page.request.get('/api/admin/products')).json()).find(
      (p: any) => p.id === 'demo-bag',
    );
  try {
    expect(
      (
        await page.request.put('/api/admin/products/' + original.id, {
          headers,
          data: { ...original, pageMode: 'landing', blocks: [] },
        })
      ).ok(),
    ).toBe(true);
    await page.goto('/admin/products');
    await page
      .locator('tbody tr')
      .filter({ hasText: original.sku })
      .getByRole('button', { name: 'تعديل', exact: true })
      .click();
    await page.getByRole('button', { name: 'تعديل صفحة الهبوط', exact: true }).click();
    const editor = page.locator('.product-customization');
    await editor.getByRole('button', { name: 'زر +', exact: true }).click();
    const background = editor.getByLabel('خلفية المساحة حول الزر', { exact: true });
    await background.fill('#fff1f8');
    await editor.getByLabel('لون الزر', { exact: true }).fill('#770044');
    await page.getByRole('button', { name: 'معاينة المسودة', exact: true }).click();
    const frame = page.frameLocator('iframe[title="معاينة صفحة المنتج"]');
    await expect(frame.locator('.cta-block')).toHaveCSS('background-color', 'rgb(255, 241, 248)');
    await expect(frame.locator('.cta-block a')).toHaveCSS('background-color', 'rgb(119, 0, 68)');
    await page.getByRole('button', { name: 'إغلاق المعاينة', exact: true }).click();
    await page.getByRole('button', { name: 'حفظ المنتج', exact: true }).click();
    await expect(page.getByText('تم حفظ المنتج.', { exact: true })).toBeVisible();
    await page.goto('/offers/daily-bag');
    await expect(page.locator('.cta-block')).toHaveCSS('background-color', 'rgb(255, 241, 248)');
    const saved = (await (await page.request.get('/api/admin/products')).json()).find(
      (p: any) => p.id === original.id,
    );
    expect(saved.blocks[0].settings.backgroundColor).toBe('#fff1f8');
    await page.goto('/admin/products');
    await page
      .locator('tbody tr')
      .filter({ hasText: original.sku })
      .getByRole('button', { name: 'تعديل', exact: true })
      .click();
    await page.getByRole('button', { name: 'تعديل صفحة الهبوط', exact: true }).click();
    await page.getByRole('button', { name: 'استخدام خلفية الصفحة', exact: true }).click();
    await page.getByRole('button', { name: 'معاينة المسودة', exact: true }).click();
    await expect(frame.locator('.cta-block')).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
    await expect(frame.locator('.cta-block a')).toHaveCSS('background-color', 'rgb(119, 0, 68)');
  } finally {
    await page.request.put('/api/admin/products/' + original.id, { headers, data: original });
  }
});
