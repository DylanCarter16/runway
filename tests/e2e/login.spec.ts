import { expect, test } from '@playwright/test';

test('login page shows the email step', async ({ page }) => {
  await page.goto('/login');
  await expect(page.getByRole('heading', { name: 'Runway' })).toBeVisible();
  await expect(page.getByPlaceholder('you@example.com')).toBeVisible();
});
