import { expect, test } from '@playwright/test';

type NoticeWindow = Window & { __glpNotice: (text: string) => void };

// HUD notices stack instead of wiping each other, and the journal keeps them on its
// Messages page after they've gone from the HUD.
test('stacks HUD notices and keeps them in the journal', async ({ page }) => {
  await page.goto('/?renderer=null&play&debug');
  await expect(page.getByTestId('hud-wind')).toBeVisible();
  await page.waitForFunction(() => '__glpNotice' in window);
  // Two lines in quick succession, as a search turns them up.
  await page.evaluate(() => {
    const w = window as unknown as NoticeWindow;
    w.__glpNotice('Found a coil of rope');
    w.__glpNotice('Found two tins of biscuit');
  });
  const status = page.getByTestId('hud-status');
  await expect(status.filter({ hasText: 'Found a coil of rope' })).toHaveCount(1);
  await expect(status.filter({ hasText: 'Found two tins of biscuit' })).toHaveCount(1);
  await expect(status.filter({ hasText: /^Found/ })).toHaveCount(0, { timeout: 10_000 });
  await page.keyboard.press('KeyJ');
  await page.getByTestId('ledger-tab-messages').click();
  const log = page.getByTestId('ledger-message');
  await expect(log).toHaveCount(2);
  await expect(log.first()).toContainText('Found two tins of biscuit');
  await expect(log.nth(1)).toContainText('Found a coil of rope');
});
