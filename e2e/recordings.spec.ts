import { expect, test } from '@playwright/test';

test.describe('as a user', () => {
  test.use({ storageState: 'e2e/.auth/user.json' });

  test('rename is offered on own missions only', async ({ page }) => {
    await page.goto('/dashboard/recordings');
    await expect(page.getByRole('button', { name: 'Rename Misi User' })).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole('button', { name: 'Rename Misi Contoh' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: /^Delete / })).toHaveCount(0);
  });
});

test.describe('as an admin', () => {
  test.use({ storageState: 'e2e/.auth/admin.json' });

  test('rename reaches Mission Report and Trends', async ({ page }) => {
    const name = `Nama Baru ${Date.now()}`;
    await page.goto('/dashboard/recordings');
    await page.getByRole('button', { name: 'Rename Misi Rename' }).click();
    const dialog = page.getByRole('dialog', { name: 'Rename recording' });
    await dialog.getByLabel('Mission name').fill(name);
    await dialog.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByText('Recording renamed')).toBeVisible();
    await expect(page.getByText(name).first()).toBeVisible();

    await page.goto('/dashboard/analytics');
    await page.getByLabel('Search missions').fill(name);
    await expect(page.getByText(name).first()).toBeVisible({ timeout: 30_000 });

    await page.goto('/dashboard/historical');
    await expect(page.getByRole('cell', { name }).or(page.getByText(name)).first()).toBeVisible({ timeout: 30_000 });
  });

  test('Delete recording says the report is kept', async ({ page }) => {
    await page.goto('/dashboard/recordings');
    await page.getByRole('button', { name: 'Delete Misi Contoh' }).click();
    await expect(page.getByRole('dialog', { name: 'Delete recording?' })).toContainText('The mission report and its data are kept.');
    await page.getByRole('button', { name: 'Cancel' }).click();
  });

  test('a recording whose file is gone says so', async ({ page }) => {
    await page.goto('/dashboard/recordings');
    await page.getByRole('button', { name: 'Play Misi File Hilang' }).click();
    await expect(page.getByText('This recording file is no longer on the server')).toBeVisible({ timeout: 15_000 });
  });

  test('a real recording plays in the player', async ({ page }) => {
    await page.goto('/dashboard/recordings');
    await page.getByRole('button', { name: 'Play Misi Contoh' }).click();
    const player = page.getByRole('dialog').locator('video');
    await expect.poll(() => player.evaluate(v => (v as HTMLVideoElement).videoWidth), { timeout: 15_000 }).toBeGreaterThan(0);
  });
});
