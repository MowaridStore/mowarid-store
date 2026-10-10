import { afterAll, beforeAll, expect, it } from 'vitest';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { build } from 'esbuild';
import { readFile, readdir } from 'node:fs/promises';

let runtime: Miniflare;
const origin = 'https://new-trainee-store.test';
const code = 'private-setup-phrase-for-one-new-store';
const key = btoa('k'.repeat(32));
let challenge = '',
  session = '',
  csrf = '';
const post = (path: string, body: unknown, cookie = challenge) =>
  runtime.dispatchFetch(origin + '/api' + path, {
    method: 'POST',
    headers: { Origin: origin, 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify(body),
  });
beforeAll(async () => {
  const bundle = await build({
    entryPoints: ['src/server/worker.ts'],
    bundle: true,
    write: false,
    format: 'esm',
    platform: 'browser',
    jsx: 'automatic',
    jsxImportSource: 'hono/jsx',
    external: ['node:crypto', 'node:buffer'],
  });
  runtime = new Miniflare(
    convertV4MiniflareOptions({
      modules: true,
      script: bundle.outputFiles[0].text,
      compatibilityDate: '2026-10-01',
      compatibilityFlags: ['nodejs_compat'],
      durableObjects: {
        PASSWORD_HASHER: { className: 'PasswordHasher', useSQLite: true },
        OPERATIONS: { className: 'StoreOperations', useSQLite: true },
      },
      d1Databases: ['DB'],
      r2Buckets: ['MEDIA', 'BACKUPS'],
      bindings: {
        ENVIRONMENT: 'production',
        INSTALLATION_MODE: 'cloudflare-button',
        ENCRYPTION_KEY: key,
        AUTH_PEPPER: 'a-test-only-pepper-for-installation',
        SETUP_TOKEN: code,
        MEDIA_ORIGIN: '/media',
      },
      outboundService: async (request) => {
        if (!request.url.endsWith('/siteverify'))
          return new Response('Unexpected outbound', { status: 503 });
        const form = await request.formData();
        return Response.json({
          success:
            form.get('secret') === 'private-widget-secret' &&
            ['verified-token', 'login-token'].includes(String(form.get('response'))),
          action: form.get('response') === 'login-token' ? 'login' : 'setup',
          hostname: new URL(origin).hostname,
        });
      },
    }),
  );
  const db = await runtime.getD1Database('DB');
  for (const file of (await readdir('migrations')).filter((f) => f.endsWith('.sql')).sort())
    await db.exec(await readFile('migrations/' + file, 'utf8'));
}, 60000);
afterAll(async () => runtime?.dispose());
it('requires the private installation code before a visitor can create the owner', async () => {
  const auth = (await (await runtime.dispatchFetch(origin + '/api/auth/status')).json()) as any;
  expect(auth).toMatchObject({ setup: true, manualBootstrap: true, canSetup: false });
  expect(JSON.stringify(auth)).not.toContain(code);
  expect((await post('/auth/bootstrap', { token: 'incorrect-code' })).status).toBe(403);
  expect(
    (
      await post(
        '/auth/setup',
        { email: 'trainee@example.test', password: 'private-test-password-for-owner' },
        '',
      )
    ).status,
  ).toBe(403);
  const bootstrap = await post('/auth/bootstrap', { token: code });
  expect(bootstrap.status).toBe(200);
  challenge = bootstrap.headers.get('set-cookie')!.split(';')[0];
  expect((await post('/setup/check', { token: code })).status).toBe(200);
});
it('checks the trainee widget before storing credentials and protects installation recovery', async () => {
  const body = {
    email: 'trainee@example.test',
    password: 'private-test-password-for-owner',
    turnstileSiteKey: '0xABCDEFGHIJKLMNO12345',
    turnstileSecret: 'private-widget-secret',
    turnstileToken: 'bad-token',
  };
  expect((await post('/auth/setup', body)).status).toBe(400);
  const db = await runtime.getD1Database('DB');
  expect(await db.prepare('SELECT COUNT(*) AS count FROM admins').first('count')).toBe(0);
  expect(await db.prepare('SELECT COUNT(*) AS count FROM credentials').first('count')).toBe(0);
  const response = await post('/auth/setup', { ...body, turnstileToken: 'verified-token' });
  expect(response.status).toBe(201);
  const saved = (await response.json()) as any;
  expect(saved.installationKey).toBe(key);
  expect(saved.recovery).toHaveLength(8);
  session = response.headers.get('set-cookie')!.split(';')[0];
  csrf = saved.csrf;
  expect(await db.prepare('SELECT password FROM admins').first('password')).toMatch(/^scrypt:/);
  const encrypted = await db
    .prepare("SELECT encrypted FROM credentials WHERE name='turnstile'")
    .first<string>('encrypted');
  expect(encrypted).not.toContain(body.turnstileSecret);
  const publicSettings = await runtime.dispatchFetch(origin + '/api/products');
  expect(await publicSettings.text()).not.toContain(body.turnstileSecret);
  const admin = await runtime.dispatchFetch(origin + '/api/admin/settings', {
    headers: { Origin: origin, Cookie: session, 'X-CSRF-Token': csrf },
  });
  expect(admin.status).toBe(200);
  const text = await admin.text();
  expect(text).not.toContain(key);
  expect(text).not.toContain(body.turnstileSecret);
  expect((await post('/auth/bootstrap', { token: code })).status).toBe(409);
  const retry = await post('/auth/setup', {
    ...body,
    turnstileSecret: 'attacker-secret',
    turnstileToken: 'verified-token',
  });
  expect(retry.status).not.toBe(201);
  expect(
    await db.prepare("SELECT encrypted FROM credentials WHERE name='turnstile'").first('encrypted'),
  ).toBe(encrypted);
});

it('uses the encrypted per-store Turnstile secret for subsequent sign-in', async () => {
  const body = { email: 'trainee@example.test', password: 'private-test-password-for-owner' };
  expect((await post('/auth/login', { ...body, turnstileToken: 'bad-token' }, '')).status).toBe(
    400,
  );
  expect((await post('/auth/login', { ...body, turnstileToken: 'login-token' }, '')).status).toBe(
    200,
  );
});
