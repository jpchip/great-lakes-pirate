import { expect, test, type Page } from '@playwright/test';

/**
 * Phase 9 piece N: winter's sounds, through the game's own paths and the audio's readout
 * (`data-winter-beds`, `__glpAudio.winter()`). Frozen in at Bayfield's city dock in
 * February, down on the ice road: the winter wind blows; the hand sled put down and loaded
 * is heard, and its runners follow it; strides on the ice are winter's own steps; thin ice
 * cracks, groans and gives way, heard and captioned; and with warmth run down the teeth
 * chatter.
 */

interface WinterLevels {
  beds: { wind: number; night: number; runners: number };
  steps: number;
  chatters: number;
  ice: number;
  sled: number;
}

interface Hooks {
  __glpFoot: {
    dock(key: string): boolean;
    land(): Promise<string | undefined>;
    interact(): void;
    state(): { active: boolean; prompt: string | undefined };
  };
  __glpIce: { skipTo(iso: string): string };
  __glpCold: {
    state(): { onIce: boolean; climbLeftS: number | undefined; sled: { cu: number } | undefined };
    toRoad(): Promise<string | undefined>;
    toShip(side?: number): void;
    walk(t: number, offM?: number): boolean;
    thin(cm?: number): void;
    warmth(v: number, wet?: number): void;
  };
  __glpAudio: { winter(): WinterLevels };
}

const hooks = <T>(page: Page, fn: (w: Hooks) => T): Promise<Awaited<T>> =>
  page.evaluate(`(${fn.toString()})(window)`) as Promise<Awaited<T>>;
const levels = (page: Page) => hooks(page, (w) => w.__glpAudio.winter());
const prompt = (page: Page) => hooks(page, (w) => w.__glpFoot.state().prompt);

test('winter heard: the wind, the sled, steps on the ice, thin ice and chattering teeth', async ({
  page,
}) => {
  test.setTimeout(240_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const body = page.locator('body');
  await page.goto('/?renderer=null&debug&play&newrun=deckhand');
  await page.waitForFunction(
    () => '__glpFoot' in window && '__glpCold' in window && '__glpAudio' in window,
  );
  // A click unlocks the audio.
  await page.mouse.click(200, 200);
  await expect(body).toHaveAttribute('data-audio', 'running');
  await expect
    .poll(() => hooks(page, (w) => w.__glpFoot.dock('bayfield_city')), { timeout: 60_000 })
    .toBe(true);
  await hooks(page, (w) => w.__glpIce.skipTo('1901-02-05'));

  await hooks(page, (w) => void w.__glpFoot.land());
  await expect.poll(() => hooks(page, (w) => w.__glpFoot.state().active)).toBe(true);
  expect(await hooks(page, (w) => w.__glpCold.toRoad())).toBeUndefined();
  await expect.poll(async () => (await hooks(page, (w) => w.__glpCold.state())).onIce).toBe(true);

  // The winter wind over the ice.
  await expect(body).toHaveAttribute('data-winter-beds', /wind/, { timeout: 15_000 });

  // The sled put down and loaded, heard; hauled, its runners hiss.
  await hooks(page, (w) => w.__glpCold.toShip(1));
  await expect.poll(() => prompt(page)).toBe('Put the hand sled down on the ice');
  await hooks(page, (w) => w.__glpFoot.interact());
  await expect.poll(() => prompt(page)).toMatch(/^Load the sled from the hold/);
  await hooks(page, (w) => w.__glpFoot.interact());
  await expect.poll(async () => (await levels(page)).sled).toBeGreaterThanOrEqual(2);
  const stepsBefore = (await levels(page)).steps;
  await page.keyboard.down('KeyW');
  await expect.poll(async () => (await levels(page)).beds.runners).toBeGreaterThan(0.2);
  await expect.poll(async () => (await levels(page)).steps).toBeGreaterThan(stepsBefore + 2);
  await page.keyboard.up('KeyW');

  // Thin ice off the road: cracks, a groan, and through.
  await page.evaluate(() => (window as unknown as Hooks).__glpCold.walk(0.5, 30));
  await hooks(page, (w) => w.__glpCold.thin(6));
  await page.keyboard.down('KeyW');
  await expect
    .poll(async () => (await hooks(page, (w) => w.__glpCold.state())).climbLeftS, {
      timeout: 30_000,
    })
    .toBeGreaterThan(0);
  await page.keyboard.up('KeyW');
  expect((await levels(page)).ice).toBeGreaterThanOrEqual(3);
  await page.keyboard.down('KeyF');
  await expect
    .poll(async () => (await hooks(page, (w) => w.__glpCold.state())).climbLeftS, {
      timeout: 15_000,
    })
    .toBeUndefined();
  await page.keyboard.up('KeyF');
  await hooks(page, (w) => w.__glpCold.thin(undefined));

  // Warmth run down: the teeth chatter.
  const chatters = (await levels(page)).chatters;
  await hooks(page, (w) => w.__glpCold.warmth(10, 1));
  await expect
    .poll(async () => (await levels(page)).chatters, { timeout: 20_000 })
    .toBeGreaterThan(chatters);
  expect(errors).toEqual([]);
});
