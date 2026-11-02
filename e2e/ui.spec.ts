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

test('recording videos offer no picture in picture', async ({ page }) => {
  await page.goto('/dashboard/recordings');
  const cards = page.locator('li video');
  await expect(cards.first()).toBeAttached({ timeout: 30_000 });
  expect(await cards.evaluateAll(vs => vs.every(v => (v as HTMLVideoElement).disablePictureInPicture))).toBe(true);

  await page.getByRole('button', { name: 'Play Misi Contoh' }).click();
  const player = page.getByRole('dialog').locator('video');
  expect(await player.evaluate(v => (v as HTMLVideoElement).disablePictureInPicture)).toBe(true);
});
