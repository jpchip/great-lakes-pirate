import { expect, test, type Page } from '@playwright/test';

/**
 * Phase 9 piece M (plan 11 §18.3 criterion 11): on the ice and in the cold. Frozen in at
 * Bayfield's city dock in February, the captain goes down onto the ice road, puts the hand
 * sled down by the ship, loads it from the hold, hauls it across to La Pointe and sells the
 * load at the trading post; walking leaves prints in the snow; thin ice cracks, groans and
 * gives way, and holding F hauls you out soaked; at no warmth left, health goes.
 */

interface ColdState {
  warmth: number;
  wet: number;
  stage: string;
  onIce: boolean;
  thin: string;
  climbLeftS: number | undefined;
  sled: { cu: number; hitched: boolean } | undefined;
  prints: number;
  road: number | undefined;
}

interface Hooks {
  __glpFoot: {
    dock(key: string): boolean;
    land(): Promise<string | undefined>;
    interact(): void;
    state(): { active: boolean; prompt: string | undefined; swimming: boolean };
  };
  __glpIce: { skipTo(iso: string): string };
  __glpCold: {
    state(): ColdState;
    road(): { open: boolean; lengthM: number; markers: number } | undefined;
    toRoad(): Promise<string | undefined>;
    toShip(side?: number): void;
    walk(t: number, offM?: number): boolean;
    thin(cm?: number): void;
    warmth(v: number, wet?: number): void;
    purse(): number;
    health(): number;
  };
}

/** Runs `fn` in the page with the hooks (a plain function: it's sent as its source). */
const hooks = <T>(page: Page, fn: (w: Hooks) => T): Promise<Awaited<T>> =>
  page.evaluate(`(${fn.toString()})(window)`) as Promise<Awaited<T>>;
const cold = (page: Page) => hooks(page, (w) => w.__glpCold.state());
const prompt = (page: Page) => hooks(page, (w) => w.__glpFoot.state().prompt);

test('the ice road: a sled of the hold to La Pointe, tracks, thin ice and the cold', async ({
  page,
}) => {
  test.setTimeout(240_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/?renderer=null&debug&play&newrun=deckhand');
  await page.waitForFunction(() => '__glpFoot' in window && '__glpCold' in window);
  await expect
    .poll(() => hooks(page, (w) => w.__glpFoot.dock('bayfield_city')), { timeout: 60_000 })
    .toBe(true);
  await hooks(page, (w) => w.__glpIce.skipTo('1901-02-05'));
  const road = await hooks(page, (w) => w.__glpCold.road());
  expect(road?.open).toBe(true);
  expect(road?.markers).toBeGreaterThan(5);

  await hooks(page, (w) => void w.__glpFoot.land());
  await expect.poll(() => hooks(page, (w) => w.__glpFoot.state().active)).toBe(true);
  expect(await hooks(page, (w) => w.__glpCold.toRoad())).toBeUndefined();
  await expect.poll(async () => (await cold(page)).onIce).toBe(true);

  // The hand sled down beside her, and loaded from the hold.
  await hooks(page, (w) => w.__glpCold.toShip(1));
  await expect.poll(() => prompt(page)).toBe('Put the hand sled down on the ice');
  await hooks(page, (w) => w.__glpFoot.interact());
  await expect.poll(() => prompt(page)).toMatch(/^Load the sled from the hold/);
  await hooks(page, (w) => w.__glpFoot.interact());
  await expect.poll(async () => (await cold(page)).sled?.cu).toBe(3);

  // Walking on the snow-covered ice leaves prints, and the cold bites.
  await page.keyboard.down('KeyW');
  await page.waitForTimeout(2500);
  await page.keyboard.up('KeyW');
  const walked = await cold(page);
  expect(walked.prints).toBeGreaterThan(0);
  expect(walked.warmth).toBeLessThan(100);

  // Across to La Pointe, and the load sold at the trading post.
  const purse = await hooks(page, (w) => w.__glpCold.purse());
  for (const t of [0.25, 0.5, 0.75, 0.99]) {
    await page.evaluate((at) => (window as unknown as Hooks).__glpCold.walk(at), t);
    await page.waitForTimeout(200);
  }
  await expect.poll(() => prompt(page)).toBe("Sell the sled's load at La Pointe's trading post");
  await hooks(page, (w) => w.__glpFoot.interact());
  await expect.poll(async () => (await cold(page)).sled?.cu).toBe(0);
  expect(await hooks(page, (w) => w.__glpCold.purse())).toBeGreaterThan(purse);

  // Thin ice off the road: it cracks, groans and gives way; F hauls you out, soaked.
  await page.evaluate(() => (window as unknown as Hooks).__glpCold.walk(0.5, 30));
  await hooks(page, (w) => w.__glpCold.thin(6));
  await page.keyboard.down('KeyW');
  await expect
    .poll(async () => (await cold(page)).climbLeftS, { timeout: 30_000 })
    .toBeGreaterThan(0);
  await page.keyboard.up('KeyW');
  await expect(page.getByTestId('foot-banner')).toContainText('Through the ice');
  await page.keyboard.down('KeyF');
  await expect.poll(async () => (await cold(page)).climbLeftS, { timeout: 15_000 }).toBeUndefined();
  await page.keyboard.up('KeyF');
  await hooks(page, (w) => w.__glpCold.thin(undefined));
  const out = await cold(page);
  expect(out.wet).toBeGreaterThan(0.9);
  expect(await hooks(page, (w) => w.__glpFoot.state().swimming)).toBe(false);

  // No warmth left: the warning shows and health goes.
  const health = await hooks(page, (w) => w.__glpCold.health());
  await hooks(page, (w) => w.__glpCold.warmth(0, 1));
  await expect(page.getByTestId('foot-warmth')).toBeVisible();
  await expect.poll(() => hooks(page, (w) => w.__glpCold.health())).toBeLessThan(health);
  expect(errors).toEqual([]);
});
