import { expect, test } from '@playwright/test';

test.use({ storageState: 'e2e/.auth/admin.json' });

test('Loading appears while the next page loads', async ({ page }) => {
  await page.route(/\/dashboard\/help\?_rsc=/, async route => {
    // Delay the page itself, not the prefetch that carries loading.tsx
    if (!route.request().headers()['next-router-prefetch']) await new Promise(r => setTimeout(r, 2000));
    await route.continue();
  });
  await page.goto('/dashboard');
  await page.waitForLoadState('networkidle').catch(() => {});
  await page.getByRole('link', { name: 'Help' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Loading…' })).toBeVisible();
});

test('the header shows whether the ROV is online', async ({ page }) => {
  const header = page.locator('header');
  // No ROV exists in the test setup, so the backend's real answer is offline
  await page.goto('/dashboard');
  await expect(header.getByText('ROV offline')).toBeVisible();
  await page.goto('/dashboard/stream');
  await expect(header.getByText('ROV offline')).toBeVisible();

  await page.route('**/api/health', async route => {
    const response = await route.fetch();
    await route.fulfill({ response, json: { ...(await response.json()), rov_online: true } });
  });
  await page.reload();
  await expect(header.getByText('ROV online')).toBeVisible();

  await page.unroute('**/api/health');
  await page.route('**/api/health', route => route.abort());
  await expect(header.getByText(/^ROV /)).toBeHidden({ timeout: 15_000 });
});

test('recording videos offer no picture in picture', async ({ page }) => {
  await page.goto('/dashboard/recordings');
  // Cards show a still JPEG, so they can't be popped out and don't download the video
  await expect(page.locator('li img').first()).toBeAttached({ timeout: 30_000 });
  await expect(page.locator('li video')).toHaveCount(0);

  await page.getByRole('button', { name: 'Play Misi Contoh' }).click();
  const player = page.getByRole('dialog').locator('video');
  expect(await player.evaluate(v => (v as HTMLVideoElement).disablePictureInPicture)).toBe(true);
});

test.describe('signed out', () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  // The browser accepts "a@b" but the backend answers 422 with a list, which used to print [object Object]
  test('an email the backend rejects shows a readable message', async ({ page }) => {
    await page.goto('/auth/login');
    await page.getByLabel('Email').fill('a@b');
    await page.getByPlaceholder('Enter your password').fill('wrong-password');
    await page.getByRole('button', { name: 'Sign in' }).click();
    const alert = page.getByRole('alert').filter({ hasText: /./ });  // skip Next's empty route announcer
    await expect(alert).toHaveText('Enter a valid email address', { timeout: 15_000 });
    await expect(alert).not.toContainText('[object');
  });
});

test('Ctrl+B collapses and expands the sidebar, but not while typing', async ({ page }) => {
  await page.goto('/dashboard/users');
  const sidebar = page.locator('aside');
  const start = await sidebar.getAttribute('data-collapsed');
  const other = start === 'true' ? 'false' : 'true';
  await page.keyboard.press('Control+b');
  await expect(sidebar).toHaveAttribute('data-collapsed', other);
  await page.reload();
  await expect(sidebar).toHaveAttribute('data-collapsed', other);
  await page.getByPlaceholder('Search name or email').focus();
  await page.keyboard.press('Control+b');
  await expect(sidebar).toHaveAttribute('data-collapsed', other);
  await page.locator('body').click({ position: { x: 600, y: 5 } });
  await page.keyboard.press('Control+b');
  await expect(sidebar).toHaveAttribute('data-collapsed', start!);
});

test('the new page content animates in after a page change, the header stays still', async ({ page }) => {
  await page.goto('/dashboard');
  await page.getByRole('link', { name: 'Recordings', exact: true }).click();
  await expect(page).toHaveURL(/recordings/);
  // The page's own <main> replaces Loading, so it must be the element carrying the animation
  const pageMain = page.locator('.page-enter main').first();
  await expect(pageMain).toBeVisible();
  expect(await pageMain.evaluate(el => getComputedStyle(el).animationName)).toBe('page-enter');
  expect(await page.locator('header').evaluate(el => getComputedStyle(el).animationName)).toBe('none');
});
