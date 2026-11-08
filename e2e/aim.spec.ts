import { expect, test, type Page } from '@playwright/test';

/**
 * Phase 6 piece B (plan 07 §3): aim mode at the helm. Tab takes up the gun, the HUD shows
 * it, the T1's steering locks, 2 is refused on a ship with no broadside, C changes the
 * shot, the swivel fires on the lay and loads again, and Tab stands down.
 */

function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });
  return errors;
}

interface CombatHook {
  arm(weapon: string, mount: string): string;
  powder(kegs: number): number;
  aimAtShip(id: string): boolean;
  aimFire(): { ok: boolean; reason?: string };
  aimState(): { active: boolean; weapon: string; ammo: string };
}

test('aims and fires the bow swivel from a T1', async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto('/?renderer=null&debug&play&encounter=tug&ship=t1');
  const body = page.locator('body');
  await expect(body).toHaveAttribute('data-zone', 'arena');
  await expect(body).toHaveAttribute('data-mode', 'sailing');
  await page.waitForFunction(() => '__glpCombat' in window);
  await page.evaluate(() => {
    const c = (window as unknown as { __glpCombat: CombatHook }).__glpCombat;
    c.arm('weapon.swivel', 'bow');
    c.powder(2);
  });

  // Tab once the helm answers (the arena's fade has lifted).
  const hud = page.getByTestId('aim-hud');
  await expect(async () => {
    if (!(await hud.isVisible())) await page.keyboard.press('Tab');
    await expect(hud).toBeVisible({ timeout: 500 });
  }).toPass({ timeout: 10_000 });
  await expect(hud).toHaveAttribute('data-weapon', 'swivel');
  await expect(page.getByTestId('aim-title')).toHaveText('Bow swivel');
  await expect(page.getByTestId('aim-steering-locked')).toBeVisible();

  await page.keyboard.press('Digit2');
  await expect(
    page.getByTestId('hud-status').filter({ hasText: 'She mounts no broadside' }),
  ).toBeVisible();
  await expect(hud).toHaveAttribute('data-weapon', 'swivel');

  await page.keyboard.press('KeyC');
  await expect(page.locator('.aim-hud-shot.selected')).toHaveText('Chain shot');

  const fired = await page.evaluate(() => {
    const c = (window as unknown as { __glpCombat: CombatHook }).__glpCombat;
    c.aimAtShip('dev.tug');
    return c.aimFire();
  });
  expect(fired).toEqual({ ok: true });
  await expect(page.getByTestId('aim-status')).toContainText('Loading');
  // Loaded again in six seconds (she may have run out of reach by then).
  await expect(page.getByTestId('aim-status')).not.toContainText('Loading', { timeout: 10_000 });

  await page.keyboard.press('Tab');
  await expect(hud).toBeHidden();
  expect(errors).toEqual([]);
});
