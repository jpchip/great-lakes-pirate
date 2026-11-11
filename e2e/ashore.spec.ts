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
    stepAshore(): Promise<string | undefined>;
    aboard(): Promise<void>;
    anchor(): void;
    dock(key: string): boolean;
    place(x: number, z: number, deg?: number): void;
    state(): FootState;
    saved(): { ashore: { from: string } | null; rowboat: { state: string } };
    save(): Promise<void>;
    teleport(x: number, z: number, y?: number): void;
    hour(h: number): void;
    suspect(on: boolean | undefined): void;
    teleportLocal(x: number, z: number, headingDeg?: number): boolean;
    watch(): {
      district: string | undefined;
      pursued: boolean;
      guards: { id: string; state: string; x: number; z: number }[];
    };
  };
  __glpAbandon: {
    founder(): boolean;
    abandon(): boolean;
    adrift(): boolean;
    landed(): string | undefined;
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

test('abandoning a foundering ship near land puts you in the boat to row ashore', async ({
  page,
}) => {
  test.setTimeout(120_000);
  const errors = collectErrors(page);
  await page.goto('/?renderer=null&debug&play');
  await page.waitForFunction(() => '__glpFoot' in window);
  await page.evaluate(() => {
    const w = window as unknown as Hooks;
    w.__glpFoot.place(-620.4, -49.04, 225);
    w.__glpAbandon.founder();
  });
  expect(await page.evaluate(() => (window as unknown as Hooks).__glpAbandon.abandon())).toBe(true);
  await expect(page.locator('body')).toHaveAttribute('data-ashore', 'boat');
  const s = await foot(page);
  expect(s.from).toBe('wreck');
  expect(await page.evaluate(() => (window as unknown as Hooks).__glpAbandon.adrift())).toBe(true);

  // Run up on the beach: landfall, and on to the nearest yard.
  await page.evaluate(() => (window as unknown as Hooks).__glpFoot.teleport(-691.1, 21.67));
  await expect
    .poll(() => page.evaluate(() => (window as unknown as Hooks).__glpFoot.stepAshore()))
    .toBeUndefined();
  const screen = page.getByTestId('jail-screen');
  await expect(screen).toContainText('Abandoned ship');
  await expect(page.getByTestId('jail-lead')).toContainText('rowed the boat ashore');
  await page.getByTestId('jail-leave').click();
  await expect(page.locator('body')).toHaveAttribute('data-ashore', 'aboard');
  expect(await page.evaluate(() => (window as unknown as Hooks).__glpAbandon.landed())).toMatch(
    /^port\./,
  );
  expect(errors).toEqual([]);
});

test('in Bayfield at night the watch walks the district, and a constable takes you to the lockup', async ({
  page,
}) => {
  test.setTimeout(180_000);
  const errors = collectErrors(page);
  await page.goto('/?renderer=null&debug&play');
  await page.waitForFunction(() => '__glpFoot' in window);
  await page.evaluate(() => {
    const f = (window as unknown as Hooks).__glpFoot;
    f.hour(23);
    f.dock('bayfield_fish');
  });
  expect(await page.evaluate(() => (window as unknown as Hooks).__glpFoot.land())).toBeUndefined();
  await expect(page.locator('body')).toHaveAttribute('data-ashore', 'foot');
  const watch = () => page.evaluate(() => (window as unknown as Hooks).__glpFoot.watch());
  const w = await watch();
  expect(w.district).toBe('district.bayfield');
  expect(w.guards.map((g) => g.id)).toContain('constable.lockup');
  // The stealth HUD is up: the light gem says how lit you are.
  await expect(page.getByTestId('stealth-gem')).toBeVisible();
  const s = await foot(page);
  expect(s.surface).toBe('wood');
  expect(s.prompt).toBe('Go aboard');

  // Up to no good in front of the lockup's constable: seen, chased and taken.
  const lockup = w.guards.find((g) => g.id === 'constable.lockup');
  await page.evaluate(
    ([x, z]) => {
      const f = (window as unknown as Hooks).__glpFoot;
      f.suspect(true);
      f.teleportLocal(x as number, (z as number) - 4, 180);
    },
    [lockup?.x ?? 0, lockup?.z ?? 0],
  );
  await expect.poll(async () => (await watch()).pursued, { timeout: 60_000 }).toBe(true);
  const screen = page.getByTestId('jail-screen');
  await expect(screen).toBeVisible({ timeout: 60_000 });
  await expect(screen).toContainText('Taken by a constable');
  await expect(page.locator('body')).toHaveAttribute('data-ashore', 'aboard');
  expect(errors).toEqual([]);
});
