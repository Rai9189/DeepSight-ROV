import { expect, test, type Page } from '@playwright/test';

// Hostile data, tiny screens and a dying server. A failure here is a finding, not a broken test.
test.use({ storageState: 'e2e/.auth/admin.json' });
test.setTimeout(120_000);

const PAGES = ['/dashboard', '/dashboard/stream', '/dashboard/recordings', '/dashboard/analytics', '/dashboard/historical', '/dashboard/help', '/dashboard/users'];

function collectErrors(page: Page) {
  const errors: string[] = [];
  page.on('pageerror', e => errors.push(`pageerror: ${e.message}`));
  page.on('response', r => {
    // No running mission, or a mission without data, is a normal 404; anything else is worth knowing
    if (r.status() >= 400 && !/\/api\/(sessions\/active|auv-status\/latest|telemetry\/latest)/.test(r.url())) errors.push(`${r.status()} ${r.url().slice(0, 120)}`);
  });
  return errors;
}

test('no page throws an error, with 600 missions and hostile names', async ({ page }) => {
  const errors = collectErrors(page);
  for (const path of PAGES) {
    await page.goto(path);
    await page.waitForLoadState('networkidle', { timeout: 30_000 }).catch(() => {});
  }
  expect(errors).toEqual([]);
});

test('every page loads in under 10 seconds with 600 missions', async ({ page }) => {
  for (const path of PAGES) {
    const started = Date.now();
    await page.goto(path);
    await expect(page.getByRole('heading').first()).toBeVisible({ timeout: 30_000 });
    const ms = Date.now() - started;
    test.info().annotations.push({ type: 'perf', description: `${path}: ${ms} ms` });
    expect.soft(ms, path).toBeLessThan(10_000);
  }
});

test('a mission named like HTML stays plain text everywhere', async ({ page }) => {
  for (const path of PAGES) {
    await page.goto(path);
    await page.waitForTimeout(1000);
    expect(await page.evaluate(() => (window as unknown as { __xss?: number }).__xss), path).toBeUndefined();
    expect(await page.locator('img[src="x"]').count(), path).toBe(0);
  }
});

for (const [name, width, height] of [['phone', 360, 640], ['tablet', 768, 1024], ['ultrawide', 3440, 1440]] as const) {
  test(`no sideways scrolling on ${name}, even with a 255-character name`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    for (const path of PAGES) {
      await page.goto(path);
      await page.waitForTimeout(1500);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect.soft(overflow, `${path} at ${width}px`).toBeLessThanOrEqual(0);
    }
  });
}

test('30 rapid page changes leave the app working', async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto('/dashboard');
  const links = ['Live Stream', 'Recordings', 'Mission Report', 'Trends', 'Help', 'Dashboard'];
  for (let i = 0; i < 30; i++) await page.getByRole('link', { name: links[i % links.length], exact: true }).first().click({ noWaitAfter: true });
  await page.getByRole('link', { name: 'Help', exact: true }).click();
  await expect(page).toHaveURL(/help/, { timeout: 30_000 });
  await expect(page.getByText('What does Reconnect do?')).toBeAttached({ timeout: 30_000 });
  expect(errors.filter(e => e.startsWith('pageerror'))).toEqual([]);
});

const payload = (data: object) => Buffer.from(JSON.stringify(data)).toString('base64url');
const expired = `${payload({ alg: 'HS256' })}.${payload({ sub: 'x', email: 'a@tes.com', role: 'ADMIN', username: 'x', exp: 1000 })}.sig`;
const forged = `${payload({ alg: 'HS256' })}.${payload({ sub: 'x', email: 'a@tes.com', role: 'ADMIN', username: 'x', exp: 9999999999 })}.sig`;
for (const [name, value] of [['garbage', 'bukan.token.asli'], ['expired', expired], ['badly signed', forged]]) {
  test(`a ${name} cookie goes to login without a loop`, async ({ context, page }) => {
    await context.clearCookies();
    await context.addCookies([{ name: 'access_token', value, domain: 'localhost', path: '/' }]);
    await page.goto('/dashboard');
    await expect(page).toHaveURL(/\/auth\/login/, { timeout: 30_000 });
    await expect(page.getByLabel('Email')).toBeVisible();
  });
}

test.describe('as a user', () => {
  test.use({ storageState: 'e2e/.auth/user.json' });

  test('the Users page is closed', async ({ page }) => {
    await page.goto('/dashboard/users');
    await expect(page).not.toHaveURL(/\/dashboard\/users/, { timeout: 30_000 });
    await expect(page.getByRole('link', { name: 'Users' })).toHaveCount(0);
  });
});

test('pages say the server is down instead of showing empty data', async ({ page }) => {
  await page.route('http://localhost:8000/**', route => route.abort());
  for (const path of ['/dashboard/analytics', '/dashboard/historical']) {
    await page.goto(path);
    await expect(page.getByText("Couldn't load missions"), path).toBeVisible({ timeout: 60_000 });
  }
});

test('login survives hostile input', async ({ page, browser }) => {
  const context = await browser.newContext({ storageState: { cookies: [], origins: [] }, baseURL: 'http://localhost:3000' });
  const login = await context.newPage();
  await login.goto('/auth/login');
  await login.getByLabel('Email').fill(`a'+or+1=1--@tes.com`);
  await login.getByPlaceholder('Enter your password').fill('x'.repeat(100_000));
  await login.getByRole('button', { name: 'Sign in' }).click();
  await expect(login.getByRole('alert').filter({ hasText: /./ })).toBeVisible({ timeout: 15_000 });
  await expect(login).toHaveURL(/login/);

  await login.goto('/auth/login?callbackUrl=https://evil.example/');
  await login.getByLabel('Email').fill('admin@tes.com');
  await login.getByPlaceholder('Enter your password').fill('rahasia88');
  await login.getByRole('button', { name: 'Sign in' }).click();
  await expect(login).toHaveURL(/localhost:3000\/dashboard/, { timeout: 30_000 });
  await context.close();
  await page.close();
});
