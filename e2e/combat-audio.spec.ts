import { expect, test, type Page } from '@playwright/test';

/**
 * Phase 6 piece G (plan 07 §14.4 row G): combat heard in the game. A warning shot from the
 * swivel bangs and splashes and starts the chase layer; the tug's crew calls out as she
 * strikes; and the grapple goes over as you come alongside to board her.
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
  };
  __glpTargets: {
    captains(): { id: string; phase: string }[];
    warn(id?: string): unknown;
  };
  __glpBoarding: {
    lay(id: string): boolean;
    astern(id: string, m?: number): number | undefined;
    board(): { opened: boolean; why?: string } | undefined;
  };
}

const TUG = 'dev.tug';

test('a warning shot bangs, splashes and starts the chase; she strikes and is grappled', async ({
  page,
}) => {
  test.setTimeout(150_000);
  const errors = collectErrors(page);
  const body = page.locator('body');
  await page.goto('/?renderer=null&debug&play&encounter=tug');
  await expect(body).toHaveAttribute('data-arena', 'ship');
  await page.waitForFunction(() => '__glpBoarding' in window && '__glpCombat' in window);
  await page.keyboard.press('KeyW');
  await expect(body).toHaveAttribute('data-audio', 'running');

  const fired = await page.evaluate((id) => {
    const w = window as unknown as Hooks;
    w.__glpCombat.arm('weapon.swivel', 'bow');
    w.__glpCombat.powder(2);
    const heading = w.__glpBoarding.astern(id, 150) ?? 0;
    return w.__glpCombat.fire(heading + 20, 250, 'ammo.warning');
  }, TUG);
  expect(fired.ok).toBe(true);
  await expect(body).toHaveAttribute('data-chase', '2');
  // The ball falls in the lake a few seconds later.
  await expect(body).toHaveAttribute('data-combat-cue', 'impact water', { timeout: 20_000 });

  // More shots across her bow until her master strikes: her crew calls out.
  await expect
    .poll(
      () =>
        page.evaluate((id) => {
          const w = window as unknown as Hooks;
          w.__glpTargets.warn(id);
          return w.__glpTargets.captains().find((c) => c.id === id)?.phase ?? '';
        }, TUG),
      { timeout: 90_000, intervals: [2_000] },
    )
    .toBe('struck');
  await expect(body).toHaveAttribute('data-combat-cue', 'struck');

  // Alongside, F: the grapple goes over.
  const opened = await page.evaluate((id) => {
    const w = window as unknown as Hooks;
    w.__glpBoarding.lay(id);
    return w.__glpBoarding.board();
  }, TUG);
  expect(opened).toEqual({ opened: true });
  await expect(body).toHaveAttribute('data-combat-cue', 'grapple');
  expect(errors).toEqual([]);
});
