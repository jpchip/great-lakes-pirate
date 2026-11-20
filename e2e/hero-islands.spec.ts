import { expect, test, type Page } from '@playwright/test';

/**
 * Phase 9 piece Q (plan 11 §18.17): the hero islands walked whole. Lands on each of the
 * seven at its first landing, finds the island under foot and its residents about by day,
 * and walks a few steps inland.
 */

interface Here {
  island?: string;
  at: { x: number; z: number };
  people: { id: string; name: string; type: string; state: string }[];
}
interface Hooks {
  __glpIslands: {
    list(): { id: string; tier?: string; landings: unknown[]; residents: unknown[] }[];
    land(id: string, k?: number): Promise<string | undefined>;
    here(): Here;
  };
  __glpFoot: { hour(h: number): void; aboard(): void };
}

const HERO = [
  'island.raspberry',
  'island.sand',
  'island.devils',
  'island.hermit',
  'island.basswood',
  'island.outer',
  'island.madeline',
];

function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });
  return errors;
}

const here = (page: Page): Promise<Here> =>
  page.evaluate(() => (window as unknown as Hooks).__glpIslands.here());

test('lands on each hero island and walks a little way', async ({ page }) => {
  test.setTimeout(300_000);
  const errors = collectErrors(page);
  await page.goto('/?renderer=null&debug&play&newrun=deckhand');
  await page.waitForFunction(() => '__glpIslands' in window);
  await page.keyboard.press('Escape');
  await page.evaluate(() => (window as unknown as Hooks).__glpFoot.hour(10));
  await page.waitForTimeout(500);

  const list = await page.evaluate(() => (window as unknown as Hooks).__glpIslands.list());
  for (const id of HERO) {
    const isl = list.find((i) => i.id === id);
    expect(isl?.tier, id).toBe('hero');
    expect(isl?.landings.length, id).toBeGreaterThan(0);
  }

  for (const id of HERO) {
    const why = await page.evaluate((i) => (window as unknown as Hooks).__glpIslands.land(i), id);
    expect(why, id).toBeUndefined();
    await expect.poll(async () => (await here(page)).island, { message: id }).toBe(id);
    const residents = list.find((i) => i.id === id)?.residents.length ?? 0;
    if (residents > 0) {
      await expect
        .poll(
          async () => (await here(page)).people.filter((p) => p.id.startsWith('resident.')).length,
          {
            message: id,
          },
        )
        .toBe(residents);
    }
    // A few steps: forward, or another way if a wall or the water's in front.
    let moved = 0;
    for (const key of ['KeyW', 'KeyA', 'KeyD', 'KeyS']) {
      const before = (await here(page)).at;
      await page.keyboard.down(key);
      await page.waitForTimeout(1500);
      await page.keyboard.up(key);
      const after = (await here(page)).at;
      moved = Math.hypot(after.x - before.x, after.z - before.z);
      if (moved > 0.5) break;
    }
    expect(moved, id).toBeGreaterThan(0.5);
    expect((await here(page)).island, id).toBe(id);
    await page.evaluate(() => (window as unknown as Hooks).__glpFoot.aboard());
    await page.waitForTimeout(1500);
  }
  expect(errors).toEqual([]);
});
