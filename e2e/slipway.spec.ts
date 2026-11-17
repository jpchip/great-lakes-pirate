/* eslint-disable @typescript-eslint/no-non-null-assertion -- the hideout the run starts with */
import { expect, test, type Page } from '@playwright/test';

/**
 * Phase 8 piece G (plan 09 §16.3 criterion 11): the slipway. Alongside the Stockton
 * landing with a slipway laid on the shore, haul her out for full repairs and fit the
 * repair stores made at the workbench. Then lose her: she founders, the abandon screen
 * offers Stockton's slipway beside the yard, and ashore there without a ship you build a
 * new schooner and go aboard her.
 */

function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });
  return errors;
}

interface Hideout {
  storage: { goods: { good: string; qty: number }[]; things?: Record<string, number> };
}

interface Hooks {
  __glpSlipway: {
    lay(id?: string): boolean;
    open(id?: string): void;
    state(): {
      shipless?: { hideout: string };
      ship: { classId: string; hull01: number; rigging01: number; upgrades: string[] };
      profile: { hull: number };
      ashore: boolean;
      from?: string;
      mode: string;
    };
  };
  __glpCraft: { give(good: string, qty: number, id?: string): boolean };
  __glpStash: { hideouts(): Record<string, Hideout> };
  __glpShipyard: { damage(hull01: number, rigging01: number): void };
  __glpPort: { dock(id: string): boolean };
  __glpAbandon: { founder(): boolean; abandon(): boolean; leftS(): number | undefined };
  __glpFoot: { place(x: number, z: number, deg?: number): void };
}

const slip = (page: Page) => page.evaluate(() => (window as unknown as Hooks).__glpSlipway.state());

test('repairs her on the ways and fits the repair stores made at Stockton', async ({ page }) => {
  test.setTimeout(120_000);
  const errors = collectErrors(page);
  const body = page.locator('body');
  await page.goto('/?renderer=null&debug&harbor=stockton');
  await expect(body).toHaveAttribute('data-terrain', 'loaded');
  await page.waitForFunction(() => '__glpSlipway' in window);
  await page.evaluate(() => {
    const w = window as unknown as Hooks;
    w.__glpSlipway.lay();
    w.__glpCraft.give('good.lumber', 8);
    w.__glpCraft.give('good.hardware', 2);
    w.__glpCraft.give('good.rope_canvas', 4);
    const h = w.__glpStash.hideouts()['hideout.stockton']!;
    h.storage.things = { 'upgrade.repair_stores': 1 };
    w.__glpShipyard.damage(0.4, 0.6);
  });
  const docked = await page.evaluate(() =>
    (window as unknown as Hooks).__glpPort.dock('stockton_landing'),
  );
  expect(docked).toBe(true);
  const screen = page.getByTestId('stash-screen');
  await expect(screen).toBeVisible({ timeout: 15_000 });
  await screen.getByTestId('stash-tab-slipway').click();
  const ways = screen.getByTestId('slipway');
  await expect(ways).toHaveAttribute('data-here', 'true');
  await expect(screen.getByTestId('slipway-hull')).toHaveText('40%');

  await screen.getByTestId('slipway-repair-go').click();
  await expect(screen.getByTestId('slipway-hull')).toHaveText('100%');
  await expect(screen.getByTestId('slipway-rigging')).toHaveText('100%');
  await screen.getByTestId('slipway-fit-upgrade.repair_stores').click();
  await expect(screen.getByTestId('slipway-upgrade')).toHaveCount(0);
  const ship = (await slip(page)).ship;
  expect(ship).toMatchObject({ hull01: 1, rigging01: 1, upgrades: ['upgrade.repair_stores'] });
  expect(errors).toEqual([]);
});

test('shipless after a sinking, builds a schooner on the slipway and goes aboard', async ({
  page,
}) => {
  test.setTimeout(180_000);
  const errors = collectErrors(page);
  const body = page.locator('body');
  await page.goto('/?renderer=null&debug&play');
  await page.waitForFunction(() => '__glpSlipway' in window);
  await page.evaluate(() => {
    const w = window as unknown as Hooks;
    w.__glpSlipway.lay();
    w.__glpCraft.give('good.lumber', 30);
    w.__glpCraft.give('good.hardware', 6);
    w.__glpCraft.give('good.rope_canvas', 6);
    // Out of the boat's reach of land, where only a passing steamer saves you.
    w.__glpFoot.place(2500, 1500, 0);
    w.__glpAbandon.founder();
  });
  const before = (await slip(page)).profile.hull;
  await expect
    .poll(() => page.evaluate(() => (window as unknown as Hooks).__glpAbandon.leftS()))
    .toBeLessThan(45);
  expect(await page.evaluate(() => (window as unknown as Hooks).__glpAbandon.abandon())).toBe(true);

  // The screen offers the slipway beside the yard.
  const screen = page.getByTestId('jail-screen');
  await expect(screen).toContainText('Where will you go?');
  await expect(page.getByTestId('jail-inside')).toContainText('your slipway can build');
  await expect(page.getByTestId('jail-leave-alt')).toHaveText('Ashore at Stockton Island');
  await page.getByTestId('jail-leave-alt').click();
  await expect(screen).toHaveCount(0);
  await expect(body).toHaveAttribute('data-shipless', 'hideout.stockton', { timeout: 60_000 });
  const ashore = await slip(page);
  expect(ashore).toMatchObject({
    shipless: { hideout: 'hideout.stockton' },
    ashore: true,
    from: 'wreck',
    mode: 'onFoot',
  });

  // At the ways: lay her down.
  await page.evaluate(() => (window as unknown as Hooks).__glpSlipway.open());
  const stash = page.getByTestId('stash-screen');
  await expect(stash.getByTestId('slipway')).toHaveAttribute('data-shipless', 'true');
  await expect(stash.getByTestId('stash-cast-off')).toHaveCount(0);
  await stash.getByTestId('slipway-build-ship').click();
  await expect(stash).toHaveCount(0);
  await expect(body).toHaveAttribute('data-shipless', 'no');
  const launched = await slip(page);
  expect(launched.shipless).toBeUndefined();
  expect(launched.mode).toBe('sailing');
  expect(launched.ship).toMatchObject({
    classId: 'ship.t1_schooner',
    hull01: 1,
    rigging01: 1,
    upgrades: [],
  });
  // A new hull: the law knows her by a new profile.
  expect(launched.profile.hull).toBeGreaterThan(before);
  const left = await page.evaluate(
    () =>
      (window as unknown as Hooks).__glpStash
        .hideouts()
        ['hideout.stockton']!.storage.goods.filter((s) => s.qty > 0).length,
  );
  expect(left).toBe(0);
  expect(errors).toEqual([]);
});
