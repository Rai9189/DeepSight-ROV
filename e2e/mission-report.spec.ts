import { expect, test, type Page } from '@playwright/test';
import { API, closeRunningMission } from './helpers/stream';

async function pick(page: Page, name: string) {
  await page.goto('/dashboard/analytics');
  const search = page.getByLabel('Search missions');
  await search.fill(name);
  await page.getByRole('option', { name }).first().click();
  await expect(page).toHaveURL(/session=/);
}

test.describe('as a user', () => {
  test.use({ storageState: 'e2e/.auth/user.json' });

  test('there is no Delete mission', async ({ page }) => {
    await pick(page, 'Misi User');
    await expect(page.getByRole('button', { name: 'Delete mission' })).toHaveCount(0);
  });
});

test.describe('as an admin', () => {
  test.use({ storageState: 'e2e/.auth/admin.json' });

  test('Delete mission is hidden while the mission is LIVE', async ({ page, request }) => {
    const created = await (await request.post(`${API}/api/sessions`, { data: { locationName: 'Sedang Jalan' } })).json();
    await page.goto(`/dashboard/analytics?session=${created.data.id}`);
    await expect(page.getByText('LIVE')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole('button', { name: 'Delete mission' })).toHaveCount(0);
    await closeRunningMission(request);
  });

  test('a deleted mission leaves the list, Recordings and Trends', async ({ page, request }) => {
    await pick(page, 'Misi Hapus');
    await page.getByRole('button', { name: 'Delete mission' }).click();
    await page.getByRole('dialog', { name: 'Delete mission?' }).getByRole('button', { name: 'Delete mission' }).click();
    await expect(page.getByText('Mission deleted')).toBeVisible();

    const names = (await (await request.get(`${API}/api/analytics/sessions`)).json()).data.map((m: { locationName: string }) => m.locationName);
    expect(names).not.toContain('Misi Hapus');
    await page.goto('/dashboard/recordings');
    await expect(page.getByRole('button', { name: 'Play Misi Contoh' })).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText('Misi Hapus')).toHaveCount(0);
    await page.goto('/dashboard/historical');
    await expect(page.getByText('Misi Contoh').first()).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText('Misi Hapus')).toHaveCount(0);
  });

  test('the mission stays selected after Watch recording and back via the sidebar', async ({ page }) => {
    test.setTimeout(120_000);
    await pick(page, 'Misi Rename');
    const url = page.url();
    await page.getByRole('link', { name: 'Watch recording' }).click();
    await expect(page).toHaveURL(/recordings\?play=/, { timeout: 30_000 });
    await expect(page.getByRole('dialog')).toBeVisible({ timeout: 30_000 });
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await page.getByRole('link', { name: 'Mission Report' }).click();
    await expect(page).toHaveURL(/analytics/);
    await expect(page.getByLabel('Search missions')).toHaveAttribute('placeholder', /./);
    expect(await page.evaluate(() => sessionStorage.getItem('mission-report:last'))).toBe(new URL(url).searchParams.get('session'));
  });

  test('the 8-hour mission with 20,000 rows opens and exports to Excel', async ({ page }) => {
    test.setTimeout(120_000);
    await pick(page, 'Misi Besar');
    await expect(page.getByText(/Latest 20 of 20,000/).first()).toBeVisible({ timeout: 30_000 });

    const started = Date.now();
    const download = page.waitForEvent('download', { timeout: 60_000 });
    await page.getByRole('button', { name: 'Excel' }).first().click();
    const file = await download;
    test.info().annotations.push({ type: 'perf', description: `Excel 20.000 baris: ${Date.now() - started} ms` });
    expect(await file.path()).toBeTruthy();
  });

  test('a bad ?session falls back to a real mission', async ({ page }) => {
    await page.goto('/dashboard/analytics?session=tidak-ada');
    await expect(page.getByLabel('Search missions')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText('No missions yet')).toHaveCount(0);
  });
});
