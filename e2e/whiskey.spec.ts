import { expect, test, type Page } from '@playwright/test';

/**
 * Phase 7 piece F, part two (plan 08 §6.2, §20.4): the whiskey trick. A ship lies at
 * Bayfield's fish pier with a deck watch at her gangway; in the evening her crew is in the
 * saloon. Stand them whiskey, find the watch asleep, lift a crate from her hold, and the
 * report comes late and names nobody. Through the dev hooks.
 */

function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });
  return errors;
}

interface Spot {
  x: number;
  z: number;
}
interface Hooks {
  __glpLaw: {
    state(): {
      reports: {
        inProgress: { witness: { name: string }; identification: string; eta: number }[];
        crimes: { crime: string; named: boolean; details?: { victim?: string } }[];
      };
    };
  };
  __glpFoot: {
    land(): Promise<string | undefined>;
    dock(key: string): boolean;
    hour(h: number): void;
    interact(): void;
    restock(): void;
    suspect(on: boolean | undefined): void;
    teleportLocal(x: number, z: number, headingDeg?: number): boolean;
    state(): { prompt: string | undefined };
    moored(): { key: string; name: string; watch: string; hold: Spot; cargo: unknown[] }[];
    crews(): { ship: string; x: number; z: number; bottles: number; stood: boolean }[];
    watch(): { guards: { id: string; state: string }[] };
    heist(): { carrying?: { good: string; owner?: string } };
    tools(): { carrying?: unknown };
  };
}

const foot = <T>(page: Page, fn: (f: Hooks['__glpFoot']) => T): Promise<T> =>
  page.evaluate(`(${fn.toString()})(window.__glpFoot)`) as Promise<T>;
const go = (page: Page, x: number, z: number) =>
  page.evaluate(
    ([a, b]) => (window as unknown as Hooks).__glpFoot.teleportLocal(a ?? 0, b ?? 0),
    [x, z],
  );

test('stand her crew whiskey, and her hold is yours while the watch sleeps', async ({ page }) => {
  test.setTimeout(180_000);
  const errors = collectErrors(page);
  await page.goto('/?renderer=null&debug&play');
  await page.waitForFunction(() => '__glpFoot' in window);
  await foot(page, (f) => {
    f.hour(20);
    f.dock('bayfield_city');
  });
  expect(await foot(page, (f) => f.land())).toBeUndefined();
  await foot(page, (f) => {
    f.suspect(false);
    f.restock();
  });

  // A ship at the pier with cargo, her watch posted, and her crew at a table.
  const ships = await foot(page, (f) => f.moored());
  const crews = await foot(page, (f) => f.crews());
  const crew = crews.find((c) => ships.some((s) => s.key === c.ship && s.cargo.length > 0));
  const ship = ships.find((s) => s.key === crew?.ship);
  expect(ship, 'a laden ship lies at the pier').toBeDefined();
  if (!ship || !crew) return;
  const watchState = async () =>
    (await foot(page, (f) => f.watch())).guards.find((g) => g.id === ship.watch)?.state;
  expect(await watchState()).not.toBe('unconscious');

  // Her crew's table in the saloon.
  expect(await go(page, crew.x + 0.4, crew.z + 0.4)).toBe(true);
  await expect
    .poll(() => foot(page, (f) => f.state().prompt))
    .toMatch(/^Stand .*'s crew whiskey \(\d bottles?\)$/);
  await foot(page, (f) => f.interact());
  await expect
    .poll(async () => (await foot(page, (f) => f.crews())).find((c) => c.ship === crew.ship)?.stood)
    .toBe(true);
  expect(await watchState()).toBe('drunk');

  // Within the hour he's asleep at her gangway.
  await foot(page, (f) => f.hour(21.5));
  await expect.poll(watchState, { timeout: 15_000 }).toBe('unconscious');

  // Her hold, from the pier beside her.
  expect(await go(page, ship.hold.x, ship.hold.z)).toBe(true);
  await expect(page.getByTestId('foot-tools').getByTestId('foot-prompt')).toContainText(
    'Lift a crate of',
  );
  await page.keyboard.down('KeyF');
  await expect
    .poll(async () => (await foot(page, (f) => f.heist())).carrying?.good, { timeout: 10_000 })
    .toBeDefined();
  await page.keyboard.up('KeyF');

  // The report is her sore-headed crew's, and names nobody.
  const reports = await page.evaluate(() => (window as unknown as Hooks).__glpLaw.state().reports);
  expect(reports.crimes).toHaveLength(1);
  expect(reports.crimes[0]?.crime).toBe('crime.burglary');
  expect(reports.crimes[0]?.named).toBe(false);
  expect(reports.inProgress).toHaveLength(1);
  const report = reports.inProgress[0];
  expect(report?.witness.name).toContain('a friendly fellow with whiskey');
  expect(report?.identification).toBe('unknown');
  // Hours after the dawn (06:00) a sober mate would have found it at.
  expect(report?.eta).toBeGreaterThan(30 * 3600);
  expect(errors).toEqual([]);
});
