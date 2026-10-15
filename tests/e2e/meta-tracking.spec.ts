import { test, expect, type Page } from '@playwright/test';
async function enableMeta(page: Page) {
  await page.route('**/offers/daily-bag', async (route) => {
    const response = await route.fetch();
    const html = (await response.text()).replace(
      /(<script[^>]*id="store-data"[^>]*>)([\s\S]*?)(<\/script>)/,
      (_, start, json, end) => {
        const data = JSON.parse(json);
        data.settings.facebookPixel = '123456';
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
        .filter((e) => e[0] === 'track')
        .map((e) => ({ event: e[1], id: e[3].eventID })),
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
