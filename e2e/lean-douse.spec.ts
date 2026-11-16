import { expect, test, type Page } from '@playwright/test';

/**
 * Lean and peek (Q/E) and putting out a lamp (plan 08 §3.1, §6; §17 cuts #2–3 taken back),
 * in Bayfield at night through the dev hooks.
 */

function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });
  return errors;
}

interface LampInfo {
  k: number;
  piece: string | undefined;
  x: number;
  y: number;
  z: number;
  lit: boolean;
  doused: boolean;
}

interface Hooks {
  __glpFoot: {
    land(): Promise<string | undefined>;
    dock(key: string): boolean;
    hour(h: number): void;
    teleportLocal(x: number, z: number, headingDeg?: number): boolean;
    lamps(): LampInfo[];
    lean(): { amount: number; offsetX: number; offsetZ: number };
    tools(): { offer: string | undefined };
    state(): { prompt: string | undefined };
  };
}

test('Bayfield at night: lean with E, and turn down a gas lamp with F held', async ({ page }) => {
  test.setTimeout(120_000);
  const errors = collectErrors(page);
  await page.goto('/?renderer=null&debug&play&seed=glp-4');
  await page.waitForFunction(() => '__glpFoot' in window);
  await page.evaluate(() => {
    const f = (window as unknown as Hooks).__glpFoot;
    f.hour(23);
    f.dock('bayfield_fish');
  });
  expect(await page.evaluate(() => (window as unknown as Hooks).__glpFoot.land())).toBeUndefined();
  await expect(page.locator('body')).toHaveAttribute('data-ashore', 'foot');

  // Lean: E held, standing still.
  await page.keyboard.down('KeyE');
  await expect
    .poll(() => page.evaluate(() => (window as unknown as Hooks).__glpFoot.lean().amount))
    .toBeGreaterThan(0.9);
  await page.keyboard.up('KeyE');
  await expect
    .poll(() => page.evaluate(() => (window as unknown as Hooks).__glpFoot.lean().amount))
    .toBe(0);

  // A gas lamp in the street, lit after dark (this seed's night has no bright moon: under one
  // the lamps are left unlit).
  await expect
    .poll(() =>
      page.evaluate(() =>
        (window as unknown as Hooks).__glpFoot
          .lamps()
          .some((l) => l.piece === 'kit.gas_lamp' && l.lit),
      ),
    )
    .toBe(true);
  const lamps = await page.evaluate(() => (window as unknown as Hooks).__glpFoot.lamps());
  const gas = lamps.find((l) => l.piece === 'kit.gas_lamp' && l.lit);
  expect(gas).toBeDefined();
  if (!gas) return;
  await page.evaluate(
    ([x, z]) => (window as unknown as Hooks).__glpFoot.teleportLocal(x as number, z as number),
    [gas.x + 0.9, gas.z],
  );
  await expect
    .poll(() => page.evaluate(() => (window as unknown as Hooks).__glpFoot.tools().offer))
    .toBe('Turn down the gas lamp');
  await page.keyboard.down('KeyF');
  await expect
    .poll(
      () =>
        page.evaluate(
          (k) => (window as unknown as Hooks).__glpFoot.lamps()[k as number]?.doused,
          gas.k,
        ),
      { timeout: 10_000 },
    )
    .toBe(true);
  await page.keyboard.up('KeyF');
  const after = await page.evaluate(
    (k) => (window as unknown as Hooks).__glpFoot.lamps()[k as number],
    gas.k,
  );
  expect(after?.lit).toBe(false);
  expect(errors).toEqual([]);
});
