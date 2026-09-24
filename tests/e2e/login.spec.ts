import { expect, test } from '@playwright/test';

test('login page shows the Google button', async ({ page }) => {
  await page.goto('/login');
  await expect(page.getByRole('heading', { name: 'Runway' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Continue with Google' })).toBeVisible();
});

test('login page shows the private message for another account', async ({ page }) => {
  await page.goto('/login?error=private');
  await expect(page.getByRole('alert')).toHaveText('This app is private.');
});
