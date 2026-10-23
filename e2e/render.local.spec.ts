import { expect, test } from '@playwright/test';

// Rendering checks run locally only (plan 01 §9, plan 17 §2); playwright.config
// leaves this file out on CI.
test('boots into the WebGL test scene without console errors', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });

  await page.goto('/');
  await expect(page.locator('#app canvas')).toBeVisible();
  await page.waitForTimeout(1000);
  expect(errors).toEqual([]);
});
