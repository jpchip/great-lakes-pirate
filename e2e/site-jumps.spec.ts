import { expect, test, type Page } from '@playwright/test';

/**
 * The dev console's hideout jumps (`?site=`) from a run whose own hideout is somewhere
 * else: a deckhand's (Stockton's, in the Apostles). Each jump must land at the site it
 * names, with the ship at that site's anchorage. Rowing in toward the zone's only
 * strongbox (Stockton's) put the Devils Island jump ashore on Rocky Island.
 */

function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });
  return errors;
}

interface Hooks {
  __glpFoot: {
    state(): { at: { x: number; z: number }; ship: { x: number; z: number } };
    island(): { island: string | undefined };
  };
}

const SITES = [
  { site: 'stockton', zone: 'zone.apostles', island: 'island.stockton' },
  { site: 'hermit', zone: 'zone.apostles', island: 'island.hermit' },
  { site: 'devils', zone: 'zone.apostles', island: 'island.devils' },
  { site: 'outer', zone: 'zone.apostles', island: 'island.outer' },
  { site: 'siskiwit', zone: 'zone.siskiwit', island: 'island.siskiwit_camp' },
  { site: 'minnesota_point', zone: 'zone.twin_ports', island: undefined },
  { site: 'north_shore', zone: 'zone.two_harbors', island: undefined },
] as const;

for (const s of SITES) {
  test(`the ${s.site} jump lands at ${s.site}, beside the ship`, async ({ page }) => {
    test.setTimeout(180_000);
    const errors = collectErrors(page);
    await page.goto(
      `/?renderer=null&debug&play&newrun=deckhand&weather=calm&zone=${s.zone}&site=${s.site}`,
    );
    await page.waitForFunction(() => '__glpFoot' in window);
    await expect(page.locator('body')).toHaveAttribute('data-zone', s.zone);
    await expect(page.locator('body')).toHaveAttribute('data-ashore', 'foot', { timeout: 90_000 });
    const where = await page.evaluate(() => {
      const foot = (window as unknown as Hooks).__glpFoot;
      return { ...foot.state(), island: foot.island().island };
    });
    if (s.island) expect(where.island).toBe(s.island);
    // Ashore by the site, not across the water from where she's anchored.
    expect(Math.hypot(where.at.x - where.ship.x, where.at.z - where.ship.z)).toBeLessThan(250);
    expect(errors).toEqual([]);
  });
}
