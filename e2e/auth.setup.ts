import { expect, test as setup } from '@playwright/test';

const ACCOUNTS = [
  { name: 'admin', email: 'admin@tes.com' },
  { name: 'user', email: 'user@tes.com' },
];

// The first dev-server compile of /dashboard can take a while
setup.setTimeout(120_000);

for (const { name, email } of ACCOUNTS) {
  setup(`${name} logs in to the Dashboard`, async ({ page }) => {
    await page.goto('/auth/login');
    await page.getByLabel('Email').fill(email);
    await page.getByPlaceholder('Enter your password').fill('rahasia88');
    await page.getByRole('button', { name: 'Sign in' }).click();

    await expect(page).toHaveURL(/\/dashboard$/, { timeout: 100_000 });
    await page.getByRole('button', { name: 'Account menu' }).click();
    await expect(page.getByText(email)).toBeVisible();

    await page.context().storageState({ path: `e2e/.auth/${name}.json` });
  });
}
