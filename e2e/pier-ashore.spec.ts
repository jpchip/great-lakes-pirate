import { expect, test, type Page } from '@playwright/test';

/**
 * Going ashore straight from a hideout's pier: alongside the Stockton landing or the
 * Siskiwit camp's dock, the stash screen offers "Go ashore (G)", and it puts the captain
 * on the pier by the ship, on foot, with no rowboat. "Go aboard" at the same spot takes
 * them back to the helm, still alongside.
 */

function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });
  return errors;
}

interface FootState {
  active: boolean;
  from: string | undefined;
  inBoat: boolean;
  boatState: string;
  at: { x: number; y: number; z: number };
  grounded: boolean;
  swimming: boolean;
  prompt: string | undefined;
  mooring: string;
}

interface Hooks {
  __glpFoot: {
    state(): FootState;
    interact(): void;
    island(): { island: string | undefined };
  };
  __glpPort: { dock(key: string): boolean };
}

const foot = (page: Page) => page.evaluate(() => (window as unknown as Hooks).__glpFoot.state());

for (const site of [
  {
    name: 'Stockton',
    url: '/?renderer=null&debug&play&newrun=deckhand',
    pier: 'stockton_landing',
    hideout: 'hideout.stockton',
    island: 'island.stockton',
  },
  {
    name: 'Siskiwit',
    url: '/?renderer=null&debug&play&newrun=lumberjack&zone=zone.siskiwit',
    pier: 'siskiwit_dock',
    hideout: 'hideout.siskiwit',
    island: 'island.siskiwit_camp',
  },
]) {
  test(`${site.name}: alongside the hideout's pier, go ashore onto it without the boat`, async ({
    page,
  }) => {
    test.setTimeout(180_000);
    const errors = collectErrors(page);
    await page.goto(site.url);
    await page.waitForFunction(() => '__glpFoot' in window && '__glpPort' in window);
    // Once the zone's berths are in, dock as F would.
    await expect
      .poll(
        () => page.evaluate((key) => (window as unknown as Hooks).__glpPort.dock(key), site.pier),
        { timeout: 60_000 },
      )
      .toBe(true);
    // Alongside, the stash opens, and it offers going ashore.
    await expect(page.locator('body')).toHaveAttribute('data-stash', site.hideout, {
      timeout: 60_000,
    });
    const button = page.getByTestId('stash-go-ashore');
    await expect(button).toBeVisible();
    await button.click();

    // On foot on the pier: no boat over the side.
    await expect(page.locator('body')).toHaveAttribute('data-ashore', 'foot', { timeout: 30_000 });
    await expect(page.locator('body')).toHaveAttribute('data-stash', 'closed');
    await expect
      .poll(async () => {
        const s = await foot(page);
        return s.grounded && !s.swimming;
      })
      .toBe(true);
    let s = await foot(page);
    expect(s.active).toBe(true);
    expect(s.from).toBe('berth');
    expect(s.inBoat).toBe(false);
    expect(s.boatState).toBe('stowed');
    expect(s.at.y).toBeGreaterThan(0.8);
    const island = await page.evaluate(() => (window as unknown as Hooks).__glpFoot.island());
    expect(island.island).toBe(site.island);

    // Standing at the gangway: back aboard, still alongside.
    expect(s.prompt).toBe('Go aboard');
    await page.evaluate(() => (window as unknown as Hooks).__glpFoot.interact());
    await expect(page.locator('body')).toHaveAttribute('data-ashore', 'aboard', {
      timeout: 30_000,
    });
    s = await foot(page);
    expect(s.active).toBe(false);
    expect(s.mooring).toBe('docked');
    expect(errors).toEqual([]);
  });
}
