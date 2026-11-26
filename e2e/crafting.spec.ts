import { expect, test, type Page } from '@playwright/test';

/**
 * Phase 8 piece E: crafting at a hideout. Alongside the Stockton landing with a workshop
 * raised beside the shack, make patch kits at the workbench with the mouse and take them
 * aboard, re-crate a stolen lot at the cooperage, load the still, and come back a week
 * later to the whiskey in the shed.
 */

interface CraftHook {
  workshop(id?: string): boolean;
  give(good: string, qty: number, id?: string, hot?: boolean): boolean;
  skip(hours: number): void;
  hideout(id?: string): {
    storage: { goods: { good: string; qty: number; hot?: { traceability: number } }[] };
  };
}

interface PortHook {
  dock(id: string): boolean;
}

const craft = (page: Page) =>
  page.evaluateHandle(() => (window as unknown as { __glpCraft: CraftHook }).__glpCraft);

test('makes kits, re-crates stolen goods and runs the still at Stockton', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const body = page.locator('body');
  await page.goto('/?renderer=null&debug&harbor=stockton');
  await expect(body).toHaveAttribute('data-terrain', 'loaded');
  await page.waitForFunction(() => '__glpCraft' in window);
  const hook = await craft(page);
  await hook.evaluate((h) => {
    h.workshop();
    h.give('good.lumber', 4);
    h.give('good.rope_canvas', 2);
    h.give('good.hardware', 2);
    h.give('good.grain', 4);
    h.give('good.furs', 2, 'hideout.stockton', true);
  });
  const docked = await page.evaluate(() =>
    (window as unknown as { __glpPort: PortHook }).__glpPort.dock('stockton_landing'),
  );
  expect(docked).toBe(true);
  const screen = page.getByTestId('stash-screen');
  await expect(screen).toBeVisible({ timeout: 15_000 });

  // The workshop: the workbench first.
  await screen.getByTestId('stash-tab-workshop').click();
  await expect(screen.getByTestId('station-tab-station.workbench')).toHaveClass(/active/);
  await screen.getByTestId('make-recipe.patch_kits').click();
  await expect(page.getByTestId('stash-message')).toHaveCount(0);
  const kits = screen.locator('[data-thing="store.patch_kit"]');
  await expect(kits).toContainText('4');
  // Crates for the re-crating, then the kits go aboard.
  await screen.getByTestId('make-recipe.crates').click();
  await expect(screen.locator('[data-thing="item.crate"]')).toContainText('4');
  await screen.getByTestId('take-thing-store.patch_kit').click();
  await expect(kits).toHaveCount(0);
  await expect(screen.getByTestId('leave-thing-store.patch_kit')).toBeVisible();

  // The cooperage: barrels for the still.
  await screen.getByTestId('station-tab-station.cooperage').click();
  await screen.getByTestId('make-recipe.barrels').click();
  await expect(screen.locator('[data-thing="item.barrel"]')).toContainText('8');

  // Re-crate the stolen furs from the shed.
  await screen.getByTestId('stash-tab-storage').click();
  const furs = screen.getByTestId('stash-store-row').filter({ hasText: 'Furs' });
  await furs.getByRole('button', { name: 'Re-crate' }).click();
  const recrated = await hook.evaluate(
    (h) => h.hideout().storage.goods.find((s) => s.good === 'good.furs')?.hot?.traceability ?? -1,
  );
  expect(recrated).toBe(0);

  // The still: load a batch, and a week later the whiskey is in the shed.
  await screen.getByTestId('stash-tab-workshop').click();
  await screen.getByTestId('station-tab-station.distillery').click();
  await screen.getByTestId('make-recipe.whiskey').click();
  await expect(screen.getByTestId('still-queue')).toContainText('ready in a week');
  await hook.evaluate((h) => h.skip(25));
  const whiskey = await hook.evaluate(
    (h) => h.hideout().storage.goods.find((s) => s.good === 'good.untaxed_whiskey')?.qty ?? 0,
  );
  expect(whiskey).toBe(12);
  await expect(screen.getByTestId('still-queue')).toContainText('Nothing loaded');
  expect(errors).toEqual([]);
});
