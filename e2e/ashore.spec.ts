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
    behindGuard(id: string, distM?: number): boolean;
    restock(): void;
    restockBurglar(): void;
    heist(): {
      carrying: { good: string; owner: string } | undefined;
      doors: { id: string; x: number; z: number; locked: boolean }[];
      containers: { mark: string; x: number; z: number; crates: Record<string, number> }[];
      hot: { good: string; qty: number; hot: { owner?: string } }[];
      prompt: string | undefined;
      stow: { x: number; z: number } | undefined;
    };
    tools(): {
      selected: string | undefined;
      carrying: string | undefined;
      conduct: string | undefined;
      offer: string | undefined;
      purse: number;
    };
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

test('at anchor away from a built island: no go ashore', async ({ page }) => {
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
  expect(why).toBe('Nothing ashore here to walk');
  await expect(page.locator('body')).toHaveAttribute('data-ashore', 'aboard');
  await expect(page.getByRole('button', { name: /Go ashore/i })).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('at the lumber pier: the port screen has no go ashore', async ({ page }) => {
  test.setTimeout(120_000);
  const errors = collectErrors(page);
  await page.goto('/?renderer=null&debug&harbor=bayfield');
  await expect(page.locator('body')).toHaveAttribute('data-terrain', 'loaded');
  await page.waitForFunction(() => '__glpPort' in window);
  expect(
    await page.evaluate(() =>
      (window as unknown as { __glpPort: { dock(k: string): boolean } }).__glpPort.dock(
        'bayfield_lumber',
      ),
    ),
  ).toBe(true);
  await expect(page.getByTestId('port-screen')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId('port-go-ashore')).toHaveCount(0);
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

test('in Bayfield the tool belt is in hand: a cosh from behind drops the constable', async ({
  page,
}) => {
  test.setTimeout(120_000);
  const errors = collectErrors(page);
  await page.goto('/?renderer=null&debug&play');
  await page.waitForFunction(() => '__glpFoot' in window);
  await page.evaluate(() => {
    const f = (window as unknown as Hooks).__glpFoot;
    f.hour(23);
    f.dock('bayfield_fish');
  });
  expect(await page.evaluate(() => (window as unknown as Hooks).__glpFoot.land())).toBeUndefined();
  const tools = () => page.evaluate(() => (window as unknown as Hooks).__glpFoot.tools());
  // The purse is in hand to start, and walking the pier is nothing to anyone.
  expect(await tools()).toMatchObject({ selected: 'tool.purse', conduct: undefined });
  await expect(page.getByTestId('foot-belt')).toBeVisible();

  // A cosh from the chandlery, in hand behind the lockup's constable.
  await page.evaluate(() => {
    const f = (window as unknown as Hooks).__glpFoot;
    f.restock();
    f.behindGuard('constable.lockup', 1.5);
  });
  await page.keyboard.press('Digit1');
  await expect.poll(async () => (await tools()).selected).toBe('tool.cosh');
  await expect.poll(async () => (await tools()).conduct).toBe('armed');
  await expect(page.getByTestId('foot-tools').getByTestId('foot-prompt')).toContainText(
    'Knock out the constable',
  );
  await page.keyboard.press('KeyF');
  await expect
    .poll(async () => {
      const w = await page.evaluate(() => (window as unknown as Hooks).__glpFoot.watch());
      return w.guards.find((g) => g.id === 'constable.lockup')?.state;
    })
    .toBe('unconscious');
  expect(errors).toEqual([]);
});

test('in Bayfield at night: pick the warehouse lock, carry a crate of its fish aboard, hot', async ({
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
  const heist = () => page.evaluate(() => (window as unknown as Hooks).__glpFoot.heist());
  // The watch looks the other way: this is about the lock and the crates.
  await page.evaluate(() => {
    const f = (window as unknown as Hooks).__glpFoot;
    f.suspect(false);
    f.restockBurglar();
  });
  const h = await heist();
  const door = h.doors.find((d) => d.id === 'hollister_warehouse.door0');
  expect(door?.locked).toBe(true);
  // Outside the door, a little way out from the warehouse's middle (-26, -20).
  await page.evaluate(
    ([x, z]) => {
      const f = (window as unknown as Hooks).__glpFoot;
      const dx = (x as number) + 26;
      const dz = (z as number) + 20;
      const out = Math.abs(dx) > Math.abs(dz) ? [Math.sign(dx) * 0.9, 0] : [0, Math.sign(dz) * 0.9];
      f.teleportLocal((x as number) + (out[0] as number), (z as number) + (out[1] as number));
    },
    [door?.x ?? 0, door?.z ?? 0],
  );
  await expect(page.getByTestId('foot-tools').getByTestId('foot-prompt')).toContainText(
    'Pick the lock (tier 1)',
  );
  await page.keyboard.down('KeyF');
  await expect
    .poll(async () => (await heist()).doors.find((d) => d.id === door?.id)?.locked, {
      timeout: 20_000,
    })
    .toBe(false);
  await page.keyboard.up('KeyF');

  // In to the crates, lift one, and down the wharf to the gangway.
  const box = h.containers.find((c) => c.mark === 'loot.0');
  await page.evaluate(
    ([x, z]) =>
      (window as unknown as Hooks).__glpFoot.teleportLocal((x as number) + 0.6, z as number),
    [box?.x ?? 0, box?.z ?? 0],
  );
  await expect(page.getByTestId('foot-tools').getByTestId('foot-prompt')).toContainText(
    'Lift a crate of',
  );
  await page.keyboard.down('KeyF');
  await expect
    .poll(async () => (await heist()).carrying?.owner, { timeout: 10_000 })
    .toBe('company.hollister_fish');
  await page.keyboard.up('KeyF');
  await expect(page.getByTestId('foot-load')).toContainText('Carrying a crate of');
  const gangway = (await heist()).stow;
  expect(gangway).toBeDefined();
  await page.evaluate(
    ([x, z]) => (window as unknown as Hooks).__glpFoot.teleportLocal(x as number, z as number),
    [gangway?.x ?? 0, gangway?.z ?? 0],
  );
  await expect(page.getByTestId('foot-tools').getByTestId('foot-prompt')).toContainText('aboard');
  await page.keyboard.press('KeyF');
  await expect.poll(async () => (await heist()).hot.length).toBe(1);
  const hot = (await heist()).hot[0];
  expect(hot?.hot.owner).toBe('company.hollister_fish');
  expect(errors).toEqual([]);
});
