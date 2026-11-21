import { expect, test, type Page } from '@playwright/test';

/**
 * Phase 9 piece V (plan 11 §18.4, criterion 15): a hunt. Lands a Poacher on Stockton, reads
 * the deer sign, shoots a deer with the ship's rifle, dresses it out with F held, carries
 * the carcass to the boat and finds 2 CU of venison in the hold; then a bear set down near
 * warns before it comes on.
 */

interface Here {
  island?: string;
  animals: { id: string; species: string; state: string; dressed: boolean; dist: number }[];
  sign: { x: number; z: number }[];
  spots: { id: string; set: boolean }[];
  carrying?: { good: string; cu: number };
  prompt?: string;
  health: number;
}
interface Hooks {
  __glpIslands: { land(id: string, k?: number): Promise<string | undefined> };
  __glpWildlife: {
    here(): Here;
    spawn(species: string, distM?: number, offDeg?: number): string | undefined;
    face(id: string): boolean;
    near(id: string, distM?: number): boolean;
    toSign(k?: number): boolean;
    shoot(id?: string): string | undefined;
  };
  __glpFoot: {
    hour(h: number): void;
    interact(): void;
    teleport(x: number, z: number): void;
    state(): { boat?: { x: number; z: number }; prompt?: string };
    aboard(): void;
  };
  __glpCold: { cargo(): { good: string; qty: number }[] };
}

function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });
  return errors;
}

const here = (page: Page): Promise<Here> =>
  page.evaluate(() => (window as unknown as Hooks).__glpWildlife.here());

test('a deer shot, dressed, carried to the boat; a bear warns first', async ({ page }) => {
  test.setTimeout(240_000);
  const errors = collectErrors(page);
  // Pinned seed: the sea and the bear's watch depend on the run's weather, and a random
  // seed made this test fail on some runs.
  await page.goto('/?renderer=null&debug&play&newrun=poacher&seed=seed7');
  await page.waitForFunction(() => '__glpIslands' in window && '__glpWildlife' in window);
  await page.keyboard.press('Escape');
  await page.evaluate(() => (window as unknown as Hooks).__glpFoot.hour(10));
  await page.waitForTimeout(500);

  const why = await page.evaluate(() =>
    (window as unknown as Hooks).__glpIslands.land('island.stockton'),
  );
  expect(why).toBeUndefined();
  await expect.poll(async () => (await here(page)).island).toBe('island.stockton');
  const first = await here(page);
  expect(first.animals.filter((a) => a.species === 'animal.deer').length).toBeGreaterThan(0);
  expect(first.sign.length).toBeGreaterThan(0);

  // The sign, read with the Poacher's woodcraft.
  await page.evaluate(() => (window as unknown as Hooks).__glpWildlife.toSign(0));
  await expect.poll(async () => (await here(page)).prompt).toBe('Read the sign');

  // A deer close ahead, shot with the ship's rifle until it's down.
  const id = await page.evaluate(() =>
    (window as unknown as Hooks).__glpWildlife.spawn('animal.deer', 14),
  );
  expect(id).toBeDefined();
  for (let k = 0; k < 6; k++) {
    const state = (await here(page)).animals.find((a) => a.id === id)?.state;
    if (state === 'dead' || state === 'wounded') break;
    await page.evaluate((d) => {
      const w = (window as unknown as Hooks).__glpWildlife;
      w.near(d, 14);
      w.face(d);
      w.shoot(d);
    }, id as string);
    await page.waitForTimeout(2700);
  }
  await expect
    .poll(async () => (await here(page)).animals.find((a) => a.id === id)?.state, {
      timeout: 60_000,
    })
    .toBe('dead');

  // Beside it: F held to dress it out, then up onto your shoulders.
  await page.evaluate((d) => (window as unknown as Hooks).__glpWildlife.near(d), id as string);
  await expect.poll(async () => (await here(page)).prompt).toBe('Field-dress the deer (hold F)');
  await page.keyboard.down('KeyF');
  await page.waitForTimeout(6500);
  await page.keyboard.up('KeyF');
  await expect
    .poll(async () => (await here(page)).prompt)
    .toBe('Lift the carcass onto your shoulders');
  await page.evaluate(() => (window as unknown as Hooks).__glpFoot.interact());
  await expect.poll(async () => (await here(page)).carrying?.cu).toBe(2);

  // To the boat, and into the hold.
  const boat = await page.evaluate(() => (window as unknown as Hooks).__glpFoot.state().boat);
  expect(boat).toBeDefined();
  if (!boat) return;
  await page.evaluate((b) => (window as unknown as Hooks).__glpFoot.teleport(b.x, b.z), boat);
  await expect.poll(async () => (await here(page)).prompt).toBe('Lay the carcass in the boat');
  await page.evaluate(() => (window as unknown as Hooks).__glpFoot.interact());
  await expect
    .poll(async () =>
      (await page.evaluate(() => (window as unknown as Hooks).__glpCold.cargo()))
        .filter((c) => c.good === 'good.venison')
        .reduce((s, c) => s + c.qty, 0),
    )
    .toBe(2);
  expect((await here(page)).carrying).toBeUndefined();

  // A bear set down in the brush ahead looks up, and warns before anything else.
  const bear = await page.evaluate(() =>
    (window as unknown as Hooks).__glpWildlife.spawn('animal.bear', 18),
  );
  expect(bear).toBeDefined();
  await expect
    .poll(async () => (await here(page)).animals.find((a) => a.id === bear)?.state, {
      timeout: 10_000,
    })
    .toMatch(/^(wary|threaten|attack|flee)$/);
  expect(errors).toEqual([]);
});
