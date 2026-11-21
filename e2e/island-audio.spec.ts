import { expect, test, type Page } from '@playwright/test';

/**
 * Phase 9 piece Y (plan 11 §18.4 row Y; plan 15 §24): the islands heard. Land on Oak Island
 * through `?ashore=oak` and the island's beds start (its birds, creek or surf, by the season
 * and the tier); the spade goes in at a dig; a sea cave's hush comes on and goes off. Through
 * the dev hooks and the audio's readout on the page.
 */

function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });
  return errors;
}

interface IslandLevels {
  ashore: boolean;
  birds: number;
  creek: number;
  surf: number;
  cave: number;
  woodpeckers: number;
  drips: number;
  last: string;
}

interface Hooks {
  __glpAudio: {
    island(): IslandLevels;
    dig(): void;
    cave(on: boolean): void;
  };
}

const audio = <T>(page: Page, fn: (a: Hooks['__glpAudio']) => T): Promise<T> =>
  page.evaluate(`(${fn.toString()})(window.__glpAudio)`) as Promise<T>;

test('the islands ashore: their beds, a dig, and a sea cave', async ({ page }) => {
  test.setTimeout(180_000);
  const errors = collectErrors(page);
  const body = page.locator('body');
  await page.goto('/?renderer=null&debug&play&newrun=deckhand&ashore=oak&seed=glp-2');
  await page.waitForFunction(() => '__glpAudio' in window);
  // A key down unlocks the audio.
  await page.keyboard.down('KeyW');
  await expect(body).toHaveAttribute('data-audio', 'running');
  await page.keyboard.up('KeyW');

  // Landed on the island: its beds are set up from then on (birds, creek or surf, by the season).
  await expect
    .poll(async () => (await audio(page, (a) => a.island())).ashore, { timeout: 60_000 })
    .toBe(true);

  // A dig at the spot: the spade goes in, and the readout says so.
  await audio(page, (a) => a.dig());
  expect((await audio(page, (a) => a.island())).last).toBe('dig');

  // A sea cave: its hush comes on inside the roof, and off once out.
  await audio(page, (a) => a.cave(true));
  await expect
    .poll(async () => (await audio(page, (a) => a.island())).cave, { timeout: 10_000 })
    .toBeGreaterThan(0);
  await audio(page, (a) => a.cave(false));
  await expect
    .poll(async () => (await audio(page, (a) => a.island())).cave, { timeout: 10_000 })
    .toBe(0);

  expect(errors.filter((e) => /island|cave|audio/i.test(e))).toEqual([]);
});
