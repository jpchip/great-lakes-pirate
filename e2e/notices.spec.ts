import { expect, test } from '@playwright/test';

// HUD notices stack instead of wiping each other, and the journal keeps them on its
// Messages page after they've gone from the HUD.
test('stacks HUD notices and keeps them in the journal', async ({ page }) => {
  await page.goto('/?renderer=null&play');
  await expect(page.getByTestId('hud-wind')).toBeVisible();
  // Open water at the start: no berth for F, no shore for G.
  await page.keyboard.press('KeyF');
  await page.keyboard.press('KeyG');
  const status = page.getByTestId('hud-status');
  await expect(status.filter({ hasText: 'No berth in reach' })).toHaveCount(1);
  await expect(status.filter({ hasText: 'No shore here' })).toHaveCount(1);
  await expect(status.filter({ hasText: /No berth|No shore/ })).toHaveCount(0, { timeout: 8000 });
  await page.keyboard.press('KeyJ');
  await page.getByTestId('ledger-tab-messages').click();
  const log = page.getByTestId('ledger-message');
  await expect(log).toHaveCount(2);
  await expect(log.first()).toContainText('No shore here');
  await expect(log.nth(1)).toContainText('No berth in reach');
});
