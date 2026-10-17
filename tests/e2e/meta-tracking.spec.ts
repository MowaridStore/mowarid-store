import { test, expect, type Page } from '@playwright/test';
async function enableMeta(page: Page, pixels = ['123456']) {
  await page.route('**/offers/daily-bag', async (route) => {
    const response = await route.fetch();
    const html = (await response.text()).replace(
      /(<script[^>]*id="store-data"[^>]*>)([\s\S]*?)(<\/script>)/,
      (_, start, json, end) => {
        const data = JSON.parse(json);
        data.settings.facebookPixel = pixels[0];
        data.settings.facebookPixels = pixels;
        data.settings.trackingEnabled = true;
        return start + JSON.stringify(data).replace(/</g, '\\u003c') + end;
      },
    );
    await route.fulfill({ response, body: html });
  });
  await page.route('https://connect.facebook.net/**', (route) =>
    route.fulfill({ body: '', contentType: 'application/javascript' }),
  );
}

for (const expired of [false, true])
  test(`Meta browser/server events share IDs and refresh expired tickets: ${expired}`, async ({
    page,
  }) => {
    const events: any[] = [];
    let bootstraps = 0,
      rejected = false;
    await enableMeta(page);
    await page.route('**/api/meta/bootstrap', (route) => {
      bootstraps++;
      return route.fulfill({
        json: { enabled: true, pixel: '123456', ticket: 'ticket-' + bootstraps },
      });
    });
    await page.route('**/api/meta/events', (route) => {
      const body = route.request().postDataJSON();
      events.push(body);
      if (expired && !rejected) {
        rejected = true;
        return route.fulfill({
          status: 403,
          json: { error: 'tracking_expired', message: 'Refresh' },
        });
      }
      return route.fulfill({ status: 202, json: { queued: true } });
    });
    await page.goto('/offers/daily-bag');
    await page.locator('#checkout-form').scrollIntoViewIfNeeded();
    await expect.poll(() => new Set(events.map((e) => e.event)).size).toBe(3);
    const browser = await page.evaluate(() =>
      ((window as any).fbq.queue as any[])
        .filter((e) => e[0] === 'trackSingle')
        .map((e) => ({ event: e[2], id: e[4].eventID })),
    );
    for (const event of browser) {
      expect(events.some((e) => e.event === event.event && e.eventId === event.id)).toBe(true);
    }
    expect(browser.map((e) => e.event).sort()).toEqual([
      'InitiateCheckout',
      'PageView',
      'ViewContent',
    ]);
    for (const e of events) {
      expect(e.path).toBe('/offers/daily-bag');
      expect(e.fbp).toMatch(/^fb\.1\.\d+\.\d+$/);
      expect(e.pixel).toBe('123456');
    }
    if (expired) {
      await expect.poll(() => bootstraps).toBe(2);
      expect(events.filter((e) => e.eventId === events[0].eventId)).toHaveLength(2);
    } else expect(bootstraps).toBe(1);
    await expect(page.locator('#checkout-error')).toHaveText('');
  });

test('CAPI connection failures do not prevent the landing checkout from working', async ({
  page,
}) => {
  await enableMeta(page);
  let attempted = false;
  await page.route('**/api/meta/bootstrap', (route) => {
    attempted = true;
    return route.abort('failed');
  });
  await page.goto('/offers/daily-bag');
  await expect.poll(() => attempted).toBe(true);
  await page.locator('input[name=name]').fill('اختبار');
  await page.locator('input[name=phone]').fill('0612345678');
  await expect(page.locator('#checkout-error')).toHaveText('');
  await expect(page.locator('input[name=name]')).toHaveValue('اختبار');
});

test('CSP permits Meta pixel fallback transport and blocks unrelated form destinations', async ({
  page,
}) => {
  let transmitted = false;
  await page.route('https://www.facebook.com/tr/', (route) => {
    transmitted = true;
    return route.fulfill({ body: 'OK', contentType: 'text/html' });
  });
  await page.goto('/');
  await page.evaluate(() => {
    (window as any).blockedDirectives = [];
    document.addEventListener('securitypolicyviolation', (e) =>
      (window as any).blockedDirectives.push(e.effectiveDirective),
    );
    const frame = document.createElement('iframe');
    frame.name = 'meta-transport-test';
    frame.hidden = true;
    document.body.appendChild(frame);
    const form = document.createElement('form');
    form.method = 'POST';
    form.target = frame.name;
    form.action = 'https://www.facebook.com/tr/';
    document.body.appendChild(form);
    form.submit();
  });
  await expect.poll(() => transmitted).toBe(true);
  await page.evaluate(() => {
    const form = document.createElement('form');
    form.method = 'POST';
    form.target = 'meta-transport-test';
    form.action = 'https://untrusted.example/events';
    document.body.appendChild(form);
    form.submit();
  });
  await expect
    .poll(() => page.evaluate(() => (window as any).blockedDirectives))
    .toContain('form-action');
});

test('two Meta destinations receive each event once with matching browser/server IDs and isolated failures', async ({
  page,
}) => {
  const events: any[] = [];
  await enableMeta(page, ['123456', '654321']);
  await page.route('**/api/meta/bootstrap', (route) =>
    route.fulfill({
      json: {
        enabled: true,
        pixels: [
          { pixel: '123456', ticket: 'first' },
          { pixel: '654321', ticket: 'second' },
        ],
      },
    }),
  );
  await page.route('**/api/meta/events', (route) => {
    const body = route.request().postDataJSON();
    events.push(body);
    return body.pixel === '654321'
      ? route.fulfill({ status: 502, json: { error: 'temporary_meta_error' } })
      : route.fulfill({ status: 202, json: { queued: true } });
  });
  await page.goto('/offers/daily-bag');
  await page.locator('#checkout-form').scrollIntoViewIfNeeded();
  await expect.poll(() => events.length).toBe(6);
  const browser = await page.evaluate(() => (window as any).fbq.queue as any[]);
  expect(browser.filter((e) => e[0] === 'init').map((e) => e[1])).toEqual(['123456', '654321']);
  expect(browser.filter((e) => e[0] === 'track')).toHaveLength(0);
  const tracked = browser.filter((e) => e[0] === 'trackSingle');
  expect(tracked).toHaveLength(6);
  for (const e of tracked)
    expect(
      events.filter(
        (server) =>
          server.pixel === e[1] && server.event === e[2] && server.eventId === e[4].eventID,
      ),
    ).toHaveLength(1);
  for (const name of ['PageView', 'ViewContent', 'InitiateCheckout'])
    expect(new Set(tracked.filter((e) => e[2] === name).map((e) => e[4].eventID)).size).toBe(1);
  expect(
    await page.locator('script[src="https://connect.facebook.net/en_US/fbevents.js"]').count(),
  ).toBe(1);
  await page.locator('input[name=name]').fill('اختبار');
  await expect(page.locator('#checkout-error')).toHaveText('');
});

test('additional pixel controls save encrypted credentials, preserve blank tokens, disable and remove a destination', async ({
  page,
}) => {
  const { readFile } = await import('node:fs/promises');
  const origin = 'http://localhost:8788';
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
    headers: { Origin: origin, 'CF-Connecting-IP': '198.18.97.1' },
    data: account,
  });
  expect(login.ok()).toBe(true);
  const headers = { Origin: origin, 'X-CSRF-Token': (await login.json()).csrf };
  const original = (await (await page.request.get('/api/admin/settings')).json()).settings;
  try {
    expect(
      (
        await page.request.put('/api/admin/settings', {
          headers,
          data: { ...original, facebookPixel: '123456', facebookAdditionalPixels: [] },
        })
      ).ok(),
    ).toBe(true);
    await page.goto('/admin/pixels');
    const extra = page.locator('.additional-meta-settings');
    await extra.locator('summary').click();
    await extra.getByRole('button', { name: 'إضافة تتبع Meta', exact: true }).click();
    const row = extra.locator('.additional-meta-destination');
    await row.getByLabel('اسم التتبع', { exact: true }).fill('الحساب الثاني');
    await row.getByLabel('معرّف البكسل الإضافي', { exact: true }).fill('654321');
    const token = 'local-second-capi-token-1234567890';
    await row.getByLabel('Meta CAPI Token', { exact: true }).fill(token);
    await row.getByRole('button', { name: 'حفظ التتبع الإضافي', exact: true }).click();
    await expect(row.getByLabel('Meta CAPI Token · محفوظ', { exact: true })).toHaveValue('');
    let saved = await (await page.request.get('/api/admin/settings')).json();
    expect(saved.credentials).toContain('meta:654321');
    expect(JSON.stringify(saved)).not.toContain(token);
    await page.reload();
    await extra.locator('summary').click();
    await expect(row.getByLabel('اسم التتبع', { exact: true })).toHaveValue('الحساب الثاني');
    await row.getByLabel('تفعيل التتبع', { exact: true }).uncheck();
    await row.getByRole('button', { name: 'حفظ التتبع الإضافي', exact: true }).click();
    await expect(row.getByRole('status')).toHaveText('التتبع متوقف.');
    saved = await (await page.request.get('/api/admin/settings')).json();
    expect(saved.settings.facebookAdditionalPixels[0].enabled).toBe(false);
    expect(saved.credentials).toContain('meta:654321');
    await row.getByRole('button', { name: 'حذف', exact: true }).click();
    await page.getByRole('button', { name: 'حفظ الإعدادات', exact: true }).click();
    await expect(page.getByText('تم حفظ التغييرات.', { exact: true })).toBeVisible();
    saved = await (await page.request.get('/api/admin/settings')).json();
    expect(saved.settings.facebookAdditionalPixels).toEqual([]);
    expect(saved.credentials).not.toContain('meta:654321');
  } finally {
    await page.request.put('/api/admin/settings', { headers, data: original });
  }
});
