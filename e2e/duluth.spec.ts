import { expect, test, type Page } from '@playwright/test';

/**
 * Phase 9 piece X (plan 11 §18.4, criterion 17; plan 08 §21): Duluth's district. Ashore at
 * the merchandise dock at night with the city's watch out; a warehouse burgled and its crate
 * carried aboard hot; and a captain taken in the Duluth region held in the police station's
 * lockup, from which a promise to the jailer gets you out to your ship. Through the dev hooks.
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
    land(): Promise<string | undefined>;
    dock(key: string): boolean;
    hour(h: number): void;
    interact(): void;
    suspect(on: boolean | undefined): void;
    restockBurglar(): void;
    teleportLocal(x: number, z: number, headingDeg?: number): boolean;
    state(): { prompt: string | undefined; mooring: string };
    tools(): { offer?: string };
    heist(): {
      carrying: { good: string; owner: string } | undefined;
      doors: { id: string; x: number; z: number; locked: boolean }[];
      containers: { mark: string; x: number; z: number }[];
      hot: { good: string; qty: number; hot: { owner?: string } }[];
      stow: { x: number; z: number } | undefined;
    };
    watch(): {
      district: string | undefined;
      guards: { id: string; type: string; state: string; x: number; z: number }[];
    };
    jailbreak():
      | { inCell: boolean; doorOpen: boolean; jailer?: { state: string; x: number; z: number } }
      | undefined;
  };
  __glpLaw: { setTier(region: string, tier: number): void };
  __glpCapture: {
    capture(region?: string): void;
    state(): { port: string; breakout: { attempts: number; active: boolean } } | null;
    record(): { logbook: { text: string }[] };
  };
}

const DULUTH = 'region.duluth';

async function ashoreAtNight(page: Page): Promise<void> {
  await page.goto('/?renderer=null&debug&play&harbor=duluth');
  await expect(page.locator('body')).toHaveAttribute('data-zone', 'zone.twin_ports');
  await page.waitForFunction(() => '__glpFoot' in window);
  await expect
    .poll(() =>
      page.evaluate(() => {
        const f = (window as unknown as Hooks).__glpFoot;
        f.hour(23);
        return f.dock('duluth_city');
      }),
    )
    .toBe(true);
  expect(await page.evaluate(() => (window as unknown as Hooks).__glpFoot.land())).toBeUndefined();
  await expect(page.locator('body')).toHaveAttribute('data-ashore', 'foot');
}

const heist = (page: Page) => page.evaluate(() => (window as unknown as Hooks).__glpFoot.heist());
const go = (page: Page, x: number, z: number) =>
  page.evaluate(
    ([a, b]) => (window as unknown as Hooks).__glpFoot.teleportLocal(a ?? 0, b ?? 0),
    [x, z],
  );

test('in Duluth at night: the watch is out, and a warehouse crate goes aboard hot', async ({
  page,
}) => {
  test.setTimeout(180_000);
  const errors = collectErrors(page);
  await ashoreAtNight(page);
  const w = await page.evaluate(() => (window as unknown as Hooks).__glpFoot.watch());
  expect(w.district).toBe('district.duluth');
  const ids = w.guards.map((g) => g.id);
  // Many police: a constable on each of three beats and one at the station.
  for (const id of [
    'constable.waterfront',
    'constable.lake_avenue',
    'constable.michigan',
    'constable.lockup',
  ]) {
    expect(ids).toContain(id);
  }
  expect(w.guards.filter((g) => g.type === 'npc.watchman').length).toBeGreaterThanOrEqual(3);

  // The watch looks the other way: this is about the lock and the crates.
  await page.evaluate(() => {
    const f = (window as unknown as Hooks).__glpFoot;
    f.suspect(false);
    f.restockBurglar();
  });
  const h = await heist(page);
  const door = h.doors.find((d) => d.id === 'transit_warehouse.door0');
  expect(door?.locked).toBe(true);
  // Just outside its door on the tracks' side (the warehouse runs z 44..60).
  expect(await go(page, door?.x ?? 0, (door?.z ?? 0) - 0.9)).toBe(true);
  await expect(page.getByTestId('foot-tools').getByTestId('foot-prompt')).toContainText(
    'Pick the lock (tier 2)',
  );
  await page.keyboard.down('KeyF');
  await expect
    .poll(async () => (await heist(page)).doors.find((d) => d.id === door?.id)?.locked, {
      timeout: 30_000,
    })
    .toBe(false);
  await page.keyboard.up('KeyF');

  const box = h.containers.find((c) => c.mark === 'loot.transit_0');
  expect(await go(page, (box?.x ?? 0) + 0.6, box?.z ?? 0)).toBe(true);
  const prompt = page.getByTestId('foot-tools').getByTestId('foot-prompt');
  // Papers or cash in the crate are gone through first; then the crates are lifted.
  if ((await prompt.textContent())?.includes('Go through')) {
    await page.keyboard.down('KeyF');
    await expect(prompt).not.toContainText('Go through', { timeout: 15_000 });
    await page.keyboard.up('KeyF');
  }
  await expect(prompt).toContainText('Lift a crate of');
  await page.keyboard.down('KeyF');
  await expect
    .poll(async () => (await heist(page)).carrying?.owner, { timeout: 10_000 })
    .toBe('company.bellwether_transit');
  await page.keyboard.up('KeyF');
  const gangway = (await heist(page)).stow;
  expect(gangway).toBeDefined();
  expect(await go(page, gangway?.x ?? 0, gangway?.z ?? 0)).toBe(true);
  await expect(page.getByTestId('foot-tools').getByTestId('foot-prompt')).toContainText('aboard');
  await page.keyboard.press('KeyF');
  await expect.poll(async () => (await heist(page)).hot.length).toBe(1);
  expect((await heist(page)).hot[0]?.hot.owner).toBe('company.bellwether_transit');
  expect(errors).toEqual([]);
});

test("taken in the Duluth region, you're held in Duluth's lockup and break out of it", async ({
  page,
}) => {
  test.setTimeout(240_000);
  const errors = collectErrors(page);
  await page.goto('/?renderer=null&debug&play&seed=glp-2&harbor=duluth');
  await expect(page.locator('body')).toHaveAttribute('data-terrain', 'loaded');
  await page.waitForFunction(() => '__glpCapture' in window && '__glpFoot' in window);
  await page.evaluate((r) => {
    const w = window as unknown as Hooks;
    w.__glpLaw.setTier(r, 2);
    w.__glpCapture.capture(r);
  }, DULUTH);
  const screen = page.getByTestId('jail-screen');
  await expect(screen).toBeVisible();
  await expect(screen).toContainText('the Duluth police station');
  expect((await page.evaluate(() => (window as unknown as Hooks).__glpCapture.state()))?.port).toBe(
    'port.duluth',
  );
  await page.getByTestId('jail-break').click();
  await expect(page.locator('body')).toHaveAttribute('data-ashore', 'foot', { timeout: 60_000 });

  const breakout = () => page.evaluate(() => (window as unknown as Hooks).__glpFoot.jailbreak());
  expect(await breakout()).toMatchObject({ inCell: true, doorOpen: false });
  const watch = await page.evaluate(() => (window as unknown as Hooks).__glpFoot.watch());
  expect(watch.district).toBe('district.duluth');

  // The jailer comes by the bars (jail.bars), and takes a promise.
  await expect
    .poll(
      async () => {
        const j = (await breakout())?.jailer;
        return j ? Math.hypot(j.x + 73.7, j.z - 87.6) < 0.8 : false;
      },
      { timeout: 90_000 },
    )
    .toBe(true);
  expect(await go(page, -74.6, 89.6)).toBe(true);
  const offer = () => page.evaluate(() => (window as unknown as Hooks).__glpFoot.tools().offer);
  await expect.poll(offer).toBe('Promise the jailer $40 from your stash');
  await page.evaluate(() => (window as unknown as Hooks).__glpFoot.interact());
  await expect.poll(async () => (await breakout())?.doorOpen).toBe(true);

  // Down Lake Avenue unseen (the watch looks away for the test) to the merchandise dock.
  await page.evaluate(() => (window as unknown as Hooks).__glpFoot.suspect(false));
  const gangway = (await heist(page)).stow;
  expect(gangway).toBeDefined();
  expect(await go(page, gangway?.x ?? 0, gangway?.z ?? 0)).toBe(true);
  await expect
    .poll(() => page.evaluate(() => (window as unknown as Hooks).__glpFoot.state().prompt))
    .toBe('Go aboard and cast off');
  await page.evaluate(() => (window as unknown as Hooks).__glpFoot.interact());
  await expect(page.locator('body')).toHaveAttribute('data-mode', 'sailing', { timeout: 20_000 });
  await expect
    .poll(() => page.evaluate(() => (window as unknown as Hooks).__glpCapture.state()))
    .toBeNull();
  const logbook = await page.evaluate(() =>
    (window as unknown as Hooks).__glpCapture
      .record()
      .logbook.map((l) => l.text)
      .join(' '),
  );
  expect(logbook).toContain("Broke out of Duluth's lockup");
  expect(errors).toEqual([]);
});
