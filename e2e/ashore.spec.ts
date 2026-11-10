import { expect, test, type Page } from '@playwright/test';

/**
 * Phase 7 piece A (plan 08 §20.4): going ashore at a berth and from an anchorage in the
 * boat, the save that remembers you're ashore, and back aboard. Through the dev hooks.
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
  surface: string;
  prompt: string | undefined;
}

interface Hooks {
  __glpFoot: {
    land(): Promise<string | undefined>;
    aboard(): Promise<void>;
    anchor(): void;
    dock(key: string): boolean;
    place(x: number, z: number, deg?: number): void;
    state(): FootState;
    saved(): { ashore: { from: string } | null; rowboat: { state: string } };
    save(): Promise<void>;
  };
}

const foot = (page: Page) => page.evaluate(() => (window as unknown as Hooks).__glpFoot.state());

test('ashore at a berth: the pier underfoot, the save remembers, and back aboard', async ({
  page,
}) => {
  test.setTimeout(120_000);
  const errors = collectErrors(page);
  await page.goto('/?renderer=null&debug&play');
  await page.waitForFunction(() => '__glpFoot' in window);
  expect(
    await page.evaluate(() => (window as unknown as Hooks).__glpFoot.dock('bayfield_city')),
  ).toBe(true);
  const why = await page.evaluate(() => (window as unknown as Hooks).__glpFoot.land());
  expect(why).toBeUndefined();
  await expect(page.locator('body')).toHaveAttribute('data-ashore', 'foot');
  await expect(page.getByTestId('foot-hud')).toBeVisible();
  const s = await foot(page);
  expect(s.active).toBe(true);
  expect(s.from).toBe('berth');
  expect(s.surface).toBe('wood');
  expect(s.prompt).toBe('Go aboard');
  const saved = await page.evaluate(() => (window as unknown as Hooks).__glpFoot.saved());
  expect(saved.ashore?.from).toBe('berth');

  // Reload: you wake where you were, ashore.
  await page.reload();
  await page.waitForFunction(() => '__glpFoot' in window);
  await expect(page.locator('body')).toHaveAttribute('data-start', 'ashore');
  await expect.poll(async () => (await foot(page)).active).toBe(true);

  await page.evaluate(() => (window as unknown as Hooks).__glpFoot.aboard());
  await expect(page.locator('body')).toHaveAttribute('data-ashore', 'aboard');
  await page.evaluate(() => (window as unknown as Hooks).__glpFoot.save());
  const after = await page.evaluate(() => (window as unknown as Hooks).__glpFoot.saved());
  expect(after.ashore).toBeNull();
  expect(errors).toEqual([]);
});

test('at anchor you go ashore in the boat', async ({ page }) => {
  test.setTimeout(120_000);
  const errors = collectErrors(page);
  await page.goto('/?renderer=null&debug&play');
  await page.waitForFunction(() => '__glpFoot' in window);
  await page.evaluate(() => {
    const f = (window as unknown as Hooks).__glpFoot;
    f.place(-620.4, -49.04, 225);
    f.anchor();
  });
  const why = await page.evaluate(() => (window as unknown as Hooks).__glpFoot.land());
  expect(why).toBeUndefined();
  await expect(page.locator('body')).toHaveAttribute('data-ashore', 'boat');
  const s = await foot(page);
  expect(s.from).toBe('anchor');
  expect(s.inBoat).toBe(true);
  const saved = await page.evaluate(() => (window as unknown as Hooks).__glpFoot.saved());
  expect(saved.rowboat.state).toBe('afloat');
  expect(errors).toEqual([]);
});
