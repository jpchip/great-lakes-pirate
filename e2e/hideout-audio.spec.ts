import { expect, test, type Page } from '@playwright/test';

/**
 * Phase 8 piece I: the sounds of building and crafting, through the game's own paths and
 * the audio's dataset readout (`data-hideout-cue`, `data-ui-cue`). Build mode at Stockton:
 * a piece placed knocks, a wall on bare ground thuds, Build plays the yard's saws and
 * hammers, a piece taken down is pried off, Escape closes the logbook. The workshop: kits
 * at the workbench end on the hammer, barrels at the cooperage, the still loaded, and its
 * batch ringing the small bell when it's done.
 */

interface Hooks {
  __glpFoot: { teleport(x: number, z: number, y?: number): void };
  __glpBuild: {
    aim(x: number, z: number): void;
    click(x: number, z: number): void;
    drag(from: [number, number], to: [number, number]): void;
    key(code: string, mods?: { ctrl?: boolean; shift?: boolean }): void;
    select(id: string, variant?: number): void;
    give(goods: Record<string, number>): boolean;
    toZone(hideout: string, x: number, z: number): { x: number; z: number } | undefined;
  };
  __glpCraft: {
    workshop(id?: string): boolean;
    give(good: string, qty: number, id?: string, hot?: boolean): boolean;
    skip(hours: number): void;
  };
  __glpPort: { dock(id: string): boolean };
}

type W = Window & Hooks;

function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));
  return errors;
}

test('build mode at Stockton: knock, thud, the yard at work, a piece pried down', async ({
  page,
}) => {
  test.setTimeout(240_000);
  const errors = collectErrors(page);
  const body = page.locator('body');
  await page.goto('/?renderer=null&debug&play&newrun=deckhand&ashore=stockton');
  await expect(body).toHaveAttribute('data-ashore', 'foot', { timeout: 90_000 });
  if (await page.getByTestId('port-screen').count()) await page.keyboard.press('Escape');
  await page.evaluate(() => {
    const w = window as unknown as W;
    const p = w.__glpBuild.toZone('hideout.stockton', 21, 13);
    if (p) w.__glpFoot.teleport(p.x, p.z);
  });
  // The key that opens build mode unlocks the audio too.
  await page.keyboard.press('KeyB');
  await expect(body).toHaveAttribute('data-mode', 'build');
  await expect(body).toHaveAttribute('data-audio', 'running');
  await expect(body).toHaveAttribute('data-hideout-cue', 'ui.ledger.open');

  // A wall on bare ground is refused with a thud.
  await page.evaluate(() => {
    const b = (window as unknown as W).__glpBuild;
    b.select('build.wall', 1);
    b.click(31, 36.1);
  });
  await expect(body).toHaveAttribute('data-hideout-cue', 'ui.build.refused');

  // Foundations laid out knock.
  await page.evaluate(() => {
    const b = (window as unknown as W).__glpBuild;
    b.give({ 'good.lumber': 12, 'good.hardware': 2 });
    b.select('build.foundation', 0);
    b.drag([31, 37], [33, 39]);
  });
  await expect(body).toHaveAttribute('data-hideout-cue', 'ui.build.place');

  // Build: the last beat over the yard is a saw or a hammer.
  await page.getByTestId('build-go').click();
  await expect(body).toHaveAttribute('data-hideout-cue', /^sfx\.build\.(saw|hammer-[12]|stone)$/);

  // One taken down is pried off.
  await page.evaluate(() => {
    const b = (window as unknown as W).__glpBuild;
    b.key('KeyX');
    b.click(31, 37);
  });
  await expect(body).toHaveAttribute('data-hideout-cue', 'sfx.build.pry');

  await page.keyboard.press('Escape');
  await expect(body).toHaveAttribute('data-mode', 'onFoot');
  await expect(body).toHaveAttribute('data-hideout-cue', 'ui.ledger.close');
  expect(errors).toEqual([]);
});

test('the workshop: the bench, the cooperage, the still and its bell', async ({ page }) => {
  test.setTimeout(180_000);
  const errors = collectErrors(page);
  const body = page.locator('body');
  await page.goto('/?renderer=null&debug&harbor=stockton');
  await expect(body).toHaveAttribute('data-terrain', 'loaded');
  await page.waitForFunction(() => '__glpCraft' in window);
  await page.evaluate(() => {
    const h = (window as unknown as W).__glpCraft;
    h.workshop();
    h.give('good.lumber', 4);
    h.give('good.rope_canvas', 2);
    h.give('good.hardware', 2);
    h.give('good.grain', 3);
  });
  expect(
    await page.evaluate(() => (window as unknown as W).__glpPort.dock('stockton_landing')),
  ).toBe(true);
  const screen = page.getByTestId('stash-screen');
  await expect(screen).toBeVisible({ timeout: 15_000 });

  // The first click unlocks the audio.
  await screen.getByTestId('stash-tab-workshop').click();
  await expect(body).toHaveAttribute('data-audio', 'running');
  await screen.getByTestId('make-recipe.patch_kits').click();
  await expect(body).toHaveAttribute('data-hideout-cue', /^sfx\.build\.hammer-[12]$/);

  await screen.getByTestId('station-tab-station.cooperage').click();
  await screen.getByTestId('make-recipe.barrels').click();
  await expect(body).toHaveAttribute('data-hideout-cue', 'sfx.craft.cooperage');

  await screen.getByTestId('station-tab-station.distillery').click();
  await screen.getByTestId('make-recipe.whiskey').click();
  await expect(body).toHaveAttribute('data-hideout-cue', 'sfx.craft.still-load');
  await page.evaluate(() => (window as unknown as W).__glpCraft.skip(25));
  await expect(body).toHaveAttribute('data-ui-cue', 'chimeSoft');
  expect(errors).toEqual([]);
});
