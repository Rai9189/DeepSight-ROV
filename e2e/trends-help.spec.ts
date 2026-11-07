import { expect, test } from '@playwright/test';
import { API } from './helpers/stream';

test.use({ storageState: 'e2e/.auth/admin.json' });

test('the fish chart labels show date and time', async ({ page }) => {
  await page.goto('/dashboard/historical');
  await page.getByRole('button', { name: 'All' }).click();
  await expect(page.locator('.recharts-cartesian-axis-tick-value').filter({ hasText: /[A-Z][a-z]{2} \d+ · \d\d:\d\d/ }).first()).toBeVisible({ timeout: 30_000 });
});

test('clearing a Custom date returns to today', async ({ page }) => {
  await page.goto('/dashboard/historical');
  await page.getByRole('button', { name: 'Custom' }).click();
  const today = await page.evaluate(() => new Date().toLocaleDateString('sv-SE'));
  await page.getByLabel('From', { exact: true }).fill('');
  await expect(page.getByLabel('From', { exact: true })).toHaveValue(today);
  await page.getByLabel('To', { exact: true }).fill('');
  await expect(page.getByLabel('To', { exact: true })).toHaveValue(today);
});

test('All counts every mission in the database', async ({ page, request }) => {
  const total = (await (await request.get(`${API}/api/analytics/sessions`)).json()).data.length;
  await page.goto('/dashboard/historical');
  await page.getByRole('button', { name: 'All' }).click();
  await expect(page.getByText('Missions', { exact: true }).first().locator('..')).toContainText(String(total), { timeout: 30_000 });
});

test('Help covers Reconnect, preview, System log, rename and delete', async ({ page }) => {
  await page.goto('/dashboard/help');
  // English by default like the rest of the app; the switch sits in the header
  const header = page.locator('header');
  await expect(header.getByRole('button', { name: 'EN', exact: true })).toHaveAttribute('aria-pressed', 'true', { timeout: 30_000 });
  for (const text of ['What does Reconnect do?', 'What is the Raw camera preview?', 'System log', 'How do I rename or delete a mission?']) {
    await expect(page.getByText(text).first()).toBeAttached();
  }
  await header.getByRole('button', { name: 'ID', exact: true }).click();
  for (const text of ['Apa fungsi Reconnect?', 'Apa itu Raw camera preview?', 'System log', 'Bagaimana cara mengganti nama atau menghapus misi?']) {
    await expect(page.getByText(text).first()).toBeAttached();
  }
  await expect(header.getByText('Cara menjalankan misi dan membaca hasilnya')).toBeVisible();
  // The choice is remembered
  await page.reload();
  await expect(page.getByText('Apa fungsi Reconnect?')).toBeAttached({ timeout: 30_000 });
});
