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
  const cards = page.locator('li video');
  await expect(cards.first()).toBeAttached({ timeout: 30_000 });
  expect(await cards.evaluateAll(vs => vs.every(v => (v as HTMLVideoElement).disablePictureInPicture))).toBe(true);

  await page.getByRole('button', { name: 'Play Misi Contoh' }).click();
  const player = page.getByRole('dialog').locator('video');
  expect(await player.evaluate(v => (v as HTMLVideoElement).disablePictureInPicture)).toBe(true);
});
