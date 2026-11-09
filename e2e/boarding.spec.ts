import { expect, test, type Page } from '@playwright/test';

/**
 * Phase 6 piece D (plan 07 §14.3 criterion 1): a T1 forces a fishing tug to strike with
 * warning shots from her swivel, boards her, loots her and lets her go without killing
 * anyone; and the solo rule keeps her off a crew that hasn't struck. Through the dev hooks.
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
  __glpCombat: {
    arm(weapon: string, mount: string): string;
    powder(kegs: number): number;
    fire(bearingDeg: number, rangeM: number, ammo: string): { ok: boolean; reason?: string };
    ships(): { id: string; killed: number; wounded: number }[];
  };
  __glpTargets: { captains(): { id: string; phase: string }[] };
  __glpBoarding: {
    lay(id: string): boolean;
    astern(id: string, m?: number): number | undefined;
    board(): { opened: boolean; why?: string } | undefined;
    record(): Record<string, { robbed?: { taken: { good: string; qty: number }[] } }>;
  };
  __glpSeaLaw: {
    crimes(): { crime: string; pending?: { id: string } }[];
    reports(): { crimeId: string; witness: { id: string }; eta: number }[];
  };
  __glpEconomy: {
    purse(): number;
    cargo(): { good: string; qty: number; hot?: { region: string } }[];
  };
}

const TUG = 'dev.tug';

async function boot(page: Page): Promise<void> {
  await page.goto('/?renderer=null&debug&play&encounter=tug');
  await expect(page.locator('body')).toHaveAttribute('data-arena', 'ship');
  await page.waitForFunction(() => '__glpBoarding' in window && '__glpCombat' in window);
}

const phaseOf = (page: Page, id: string) =>
  page.evaluate(
    (i) =>
      (window as unknown as Hooks).__glpTargets.captains().find((c) => c.id === i)?.phase ?? '',
    id,
  );

test('a T1 can only board a ship that has struck, and says why', async ({ page }) => {
  const errors = collectErrors(page);
  await boot(page);
  const refused = await page.evaluate((id) => {
    const w = window as unknown as Hooks;
    w.__glpBoarding.lay(id);
    return w.__glpBoarding.board();
  }, TUG);
  expect(refused).toEqual({ opened: false, why: "You can't take a resisting crew single-handed" });
  await expect(page.getByTestId('boarding-screen')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('a T1 forces a tug to strike with warning shots and loots her without killing anyone', async ({
  page,
}) => {
  test.setTimeout(180_000);
  const errors = collectErrors(page);
  await boot(page);
  await page.evaluate(() => {
    const w = window as unknown as Hooks;
    w.__glpCombat.arm('weapon.swivel', 'bow');
    w.__glpCombat.powder(2);
  });

  // Warning shots across her bow from the swivel until her master strikes.
  await expect
    .poll(
      async () => {
        await page.evaluate((id) => {
          const w = window as unknown as Hooks;
          // From 150 m astern of her, a shot 20° off her heading at 250 m falls about 85 m
          // ahead of her bow and as far abeam: across her bow, clear of her.
          const heading = w.__glpBoarding.astern(id, 150) ?? 0;
          w.__glpCombat.fire(heading + 20, 250, 'ammo.warning');
        }, TUG);
        return phaseOf(page, TUG);
      },
      { timeout: 120_000, intervals: [7_000] },
    )
    .toBe('struck');

  // Alongside, F: her papers handed over, straight to her hold.
  const purse0 = await page.evaluate(() => (window as unknown as Hooks).__glpEconomy.purse());
  const opened = await page.evaluate((id) => {
    const w = window as unknown as Hooks;
    w.__glpBoarding.lay(id);
    return w.__glpBoarding.board();
  }, TUG);
  expect(opened).toEqual({ opened: true });
  const screen = page.getByTestId('boarding-screen');
  await expect(screen).toHaveAttribute('data-stage', 'loot');
  await page.getByTestId('loot-take-cash').click();
  await page.getByTestId('loot-take-good.fresh_fish').click({ modifiers: ['Shift'] });
  await page.getByTestId('loot-done').click();
  await expect(screen).toHaveAttribute('data-stage', 'aftermath');
  await page.getByTestId('aftermath-letGo').click();
  await expect(screen).toHaveCount(0);

  const after = await page.evaluate((id) => {
    const w = window as unknown as Hooks;
    return {
      purse: w.__glpEconomy.purse(),
      hot: w.__glpEconomy.cargo().filter((s) => s.good === 'good.fresh_fish' && s.hot),
      damage: w.__glpCombat.ships().find((s) => s.id === id),
      robbed: w.__glpBoarding.record()[id]?.robbed,
    };
  }, TUG);
  expect(after.purse).toBeGreaterThan(purse0);
  expect(after.hot.length).toBe(1);
  expect(after.robbed?.taken).toEqual([{ good: 'good.fresh_fish', qty: after.hot[0]?.qty }]);
  // Nobody killed: warning shots fall clear and she gave in.
  expect(after.damage?.killed ?? 0).toBe(0);
  await expect.poll(() => phaseOf(page, TUG)).toBe('fled');

  // Piece F (criterion 7): her crew, let go, sets off to tell of it at her next port.
  const law = await page.evaluate(() => {
    const w = window as unknown as Hooks;
    return { crimes: w.__glpSeaLaw.crimes(), reports: w.__glpSeaLaw.reports() };
  });
  expect(law.crimes.map((c) => c.crime)).toContain('crime.piracy');
  expect(law.crimes.some((c) => c.pending)).toBe(false);
  expect(law.reports.some((r) => r.witness.id === `crew.${TUG}`)).toBe(true);

  // Stripped: she can't be boarded again this passage.
  const again = await page.evaluate((id) => {
    const w = window as unknown as Hooks;
    w.__glpBoarding.lay(id);
    return w.__glpBoarding.board();
  }, TUG);
  expect(again).toEqual({ opened: false, why: 'You have already stripped her' });
  expect(errors).toEqual([]);
});
