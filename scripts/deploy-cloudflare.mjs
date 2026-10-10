import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

// Deploy to Cloudflare / Workers Builds. No fixtures, customer data or author account IDs.
const config = process.env.MOWARID_DEPLOY_CONFIG || 'wrangler.toml';
const cli = resolve('node_modules/wrangler/bin/wrangler.js');
const run = (args) =>
  new Promise((ok, fail) => {
    const child = spawn(process.execPath, [cli, ...args, '--config', config], {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, WRANGLER_SEND_METRICS: 'false' },
    });
    let stdout = '',
      stderr = '';
    child.stdout.on('data', (v) => (stdout += v));
    child.stderr.on('data', (v) => (stderr += v));
    child.once('error', fail);
    child.once('exit', (code) =>
      code === 0
        ? ok(stdout)
        : fail(
            Object.assign(new Error('Cloudflare command failed'), { diagnostic: stderr + stdout }),
          ),
    );
  });
const json = (stdout) =>
  JSON.parse(stdout.replace(/\x1b\[[0-9;]*m/g, '').match(/\[[\s\S]*\]\s*$/)?.[0] || 'null');
let temporary;
try {
  let names = [];
  try {
    names = json(await run(['secret', 'list'])).map((v) => v.name);
  } catch (error) {
    if (!/(10007|worker.*not found|could not find.*worker)/i.test(error.diagnostic || ''))
      throw error;
  }
  const initialized = ['ENCRYPTION_KEY', 'AUTH_PEPPER'].every((name) => names.includes(name));
  if (initialized) {
    console.log('Preparing the store database. Existing data is preserved.');
    await run(['d1', 'migrations', 'apply', 'DB', '--remote']);
  }
  console.log('Provisioning the store resources.');
  const provisioned = await run(['deploy', '--keep-vars']);
  if (!initialized) await run(['d1', 'migrations', 'apply', 'DB', '--remote']);
  const deploymentUrl = provisioned.match(/https:\/\/[a-z0-9.-]+\.workers\.dev/gi)?.at(-1);
  if (!deploymentUrl) throw new Error('Cloudflare did not return a store URL.');
  let status;
  for (let attempt = 0; attempt < 5 && !status; attempt++) {
    try {
      const response = await fetch(deploymentUrl + '/api/auth/status', {
        redirect: 'error',
        signal: AbortSignal.timeout(10000),
      });
      if (response.ok) status = await response.json();
    } catch {
      // A new deployment can need a moment to become reachable at the edge.
    }
    if (!status && attempt < 4) await new Promise((done) => setTimeout(done, 2000));
  }
  if (!status) throw new Error('Could not verify the installation origin. Retry the build.');
  const canonical = new URL(status.storeOrigin || deploymentUrl);
  if (canonical.protocol !== 'https:' || canonical.username || canonical.password)
    throw new Error('Invalid canonical store origin.');
  const db = json(
    await run([
      'd1',
      'execute',
      'DB',
      '--remote',
      '--json',
      '--command',
      'SELECT (SELECT COUNT(*) FROM admins) AS owners,(SELECT COUNT(*) FROM credentials) AS credentials,(SELECT COUNT(*) FROM orders) AS orders',
    ]),
  );
  const counts = db?.[0]?.results?.[0];
  if (!counts) throw new Error('Could not verify database state');
  names = json(await run(['secret', 'list'])).map((v) => v.name);
  if (!names.includes('SETUP_TOKEN'))
    throw new Error('Add a private SETUP_TOKEN in the Cloudflare deployment settings, then retry.');
  const missing = ['ENCRYPTION_KEY', 'AUTH_PEPPER'].filter((name) => !names.includes(name));
  if (missing.length && (counts.owners || counts.credentials || counts.orders))
    throw new Error(
      'Original installation secrets are missing. Restore them; automatic rotation is blocked.',
    );
  const args = ['deploy', '--keep-vars', '--var', 'APP_ORIGIN:' + canonical.origin];
  if (missing.length) {
    temporary = await mkdtemp(join(tmpdir(), 'mowarid-install-'));
    const path = join(temporary, 'generated-secrets.json');
    await writeFile(
      path,
      JSON.stringify(
        Object.fromEntries(missing.map((name) => [name, randomBytes(32).toString('base64')])),
      ),
      { mode: 0o600 },
    );
    args.push('--secrets-file', path);
  }
  console.log('Publishing with private, per-installation keys. No secret values are printed.');
  const output = await run(args);
  const url = output.match(/https:\/\/[a-z0-9.-]+\.workers\.dev/gi)?.at(-1);
  if (url) console.log('Store dashboard: ' + url + '/admin');
  console.log(
    'Deployment complete. Open /admin and use your private SETUP_TOKEN to create the owner account.',
  );
} catch (error) {
  console.error(
    error.message === 'Cloudflare command failed'
      ? 'Deployment could not finish. Check Cloudflare build permissions for Workers, D1 and R2, and enable R2 in your account. No data or keys were reset.'
      : error.message,
  );
  process.exitCode = 1;
} finally {
  if (temporary) await rm(temporary, { recursive: true, force: true });
}
