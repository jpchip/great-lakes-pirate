import { expect, test, type Page } from '@playwright/test';

/**
 * Phase 9 piece G (plan 11 §18.3 criterion 7): the four new stations. Alongside the
 * Stockton landing with the workshop and a slipway raised beside the shack, tan a suit of
 * sails at the sail loft, make up powder by the keg in the powder room, draw corrected
 * charts at the cartography table and hang fish in the smokehouse; then fit the sails and
 * the charts at the slipway, and a week later the cured fish is in the shed.
 */

interface Hooks {
  __glpCraft: {
    workshop(id?: string): boolean;
    give(good: string, qty: number, id?: string): boolean;
    skip(hours: number): void;
    hideout(id?: string): {
      storage: { goods: { good: string; qty: number }[]; things?: Record<string, number> };
    };
  };
  __glpSlipway: {
    lay(id?: string): boolean;
    state(): { ship: { upgrades: string[] } };
  };
  __glpPort: { dock(id: string): boolean };
}

const goodQty = (page: Page, good: string) =>
  page.evaluate(
    (g) =>
      (window as unknown as Hooks).__glpCraft
        .hideout()
        .storage.goods.filter((s) => s.good === g)
        .reduce((a, s) => a + s.qty, 0),
    good,
  );

test('the loft, powder room, table and smokehouse make their work, and it fits', async ({
  page,
}) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const body = page.locator('body');
  await page.goto('/?renderer=null&debug&harbor=stockton');
  await expect(body).toHaveAttribute('data-terrain', 'loaded');
  await page.waitForFunction(() => '__glpCraft' in window && '__glpSlipway' in window);
  await page.evaluate(() => {
    const w = window as unknown as Hooks;
    w.__glpCraft.workshop();
    w.__glpSlipway.lay();
    w.__glpCraft.give('good.rope_canvas', 4);
    w.__glpCraft.give('good.lumber', 4);
    w.__glpCraft.give('good.hardware', 4);
    w.__glpCraft.give('good.coal', 3);
    w.__glpCraft.give('good.dry_goods', 1);
    w.__glpCraft.give('good.fresh_fish', 3);
  });
  const docked = await page.evaluate(() =>
    (window as unknown as Hooks).__glpPort.dock('stockton_landing'),
  );
  expect(docked).toBe(true);
  const screen = page.getByTestId('stash-screen');
  await expect(screen).toBeVisible({ timeout: 15_000 });
  await screen.getByTestId('stash-tab-workshop').click();

  // The cooperage's barrels for the smokehouse first.
  await screen.getByTestId('station-tab-station.cooperage').click();
  await screen.getByTestId('make-recipe.barrels').click();
  await expect(screen.locator('[data-thing="item.barrel"]')).toContainText('8');

  // The sail loft: a suit of dark-tanned sails, with the well's water for the vat.
  await screen.getByTestId('station-tab-station.sail_loft').click();
  await screen.getByTestId('make-recipe.dark_sails').click();
  await expect(screen.locator('[data-thing="upgrade.dark_sails"]')).toContainText('1');

  // The powder room: four kegs from the forge's iron and coal.
  await screen.getByTestId('station-tab-station.powder_room').click();
  await screen.getByTestId('make-recipe.powder_kegs').click();
  expect(await goodQty(page, 'good.powder_shot')).toBe(4);

  // The cartography table: corrected charts.
  await screen.getByTestId('station-tab-station.cartography').click();
  await screen.getByTestId('make-recipe.corrected_charts').click();
  await expect(screen.locator('[data-thing="upgrade.corrected_charts"]')).toContainText('1');

  // The smokehouse: hang a batch and leave it.
  await screen.getByTestId('station-tab-station.smokehouse').click();
  await expect(screen.getByTestId('make-recipe.smoked_fish')).toHaveText('Hang it in the smoke');
  await screen.getByTestId('make-recipe.smoked_fish').click();
  await expect(screen.getByTestId('still-queue')).toContainText('In the smokehouse (1 / 4)');
  await expect(screen.getByTestId('still-queue')).toContainText('ready in a week');

  // Fit the sails and the charts on the ways.
  await screen.getByTestId('stash-tab-slipway').click();
  await screen.getByTestId('slipway-fit-upgrade.dark_sails').click();
  await screen.getByTestId('slipway-fit-upgrade.corrected_charts').click();
  await expect(screen.getByTestId('slipway-upgrade')).toHaveCount(0);
  const upgrades = await page.evaluate(
    () => (window as unknown as Hooks).__glpSlipway.state().ship.upgrades,
  );
  expect(upgrades).toEqual(
    expect.arrayContaining(['upgrade.dark_sails', 'upgrade.corrected_charts']),
  );

  // A week on, the fish is cured and in the shed.
  await page.evaluate(() => (window as unknown as Hooks).__glpCraft.skip(25));
  expect(await goodQty(page, 'good.salted_fish')).toBe(3);
  expect(errors).toEqual([]);
});
