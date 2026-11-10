import { expect, test, type Page } from '@playwright/test';

/**
 * Phase 6 piece F (plan 07 §14.3 criterion 9, §14.6 decision 2): your ship founders, you
 * abandon her, and you're landed at a port with a shipyard aboard a worn hull of the yard's,
 * her cargo lost and her wreck on the record. Through the dev hooks.
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
  __glpAbandon: {
    founder(): boolean;
    abandon(): boolean;
    leftS(): number | undefined;
    open(): boolean;
    landed(): string | undefined;
    docked(): string | undefined;
  };
  __glpSeaLaw: { wrecks(): { how: string; byPlayer: boolean; name: string }[] };
  __glpEconomy: { cargo(): { good: string; qty: number }[] };
  __glpFoot: { place(x: number, z: number, deg?: number): void };
}

test('a foundering ship is abandoned and you are landed at a yard aboard a worn hull', async ({
  page,
}) => {
  test.setTimeout(120_000);
  const errors = collectErrors(page);
  await page.goto('/?renderer=null&debug&play');
  await page.waitForFunction(() => '__glpAbandon' in window);
  // Out of the boat's reach of land, where only a passing steamer saves you.
  await page.evaluate(() => {
    const w = window as unknown as Hooks;
    w.__glpFoot.place(2500, 1500, 0);
    w.__glpAbandon.founder();
  });
  // She starts going down: the clock runs.
  await expect
    .poll(() => page.evaluate(() => (window as unknown as Hooks).__glpAbandon.leftS()))
    .toBeLessThan(45);
  const went = await page.evaluate(() => (window as unknown as Hooks).__glpAbandon.abandon());
  expect(went).toBe(true);

  const screen = page.getByTestId('jail-screen');
  await expect(screen).toHaveAttribute('data-kind', 'released');
  await expect(screen).toContainText('Abandoned ship');
  await expect(page.getByTestId('jail-lead')).toContainText('foundered');
  await expect(page.getByTestId('jail-inside')).toContainText('let you have a worn');

  const after = await page.evaluate(() => {
    const w = window as unknown as Hooks;
    return {
      landed: w.__glpAbandon.landed(),
      wrecks: w.__glpSeaLaw.wrecks(),
      cargo: w.__glpEconomy.cargo(),
    };
  });
  expect(after.landed).toMatch(/^port\./);
  expect(after.cargo).toEqual([]);
  expect(after.wrecks.some((w) => w.how === 'abandoned' && w.byPlayer)).toBe(true);

  await page.getByTestId('jail-leave').click();
  await expect(screen).toHaveCount(0);
  await expect
    .poll(() => page.evaluate(() => (window as unknown as Hooks).__glpAbandon.docked()), {
      timeout: 60_000,
    })
    .toBe(after.landed);
  expect(errors).toEqual([]);
});

test('closing the tab while she founders lands you back in it', async ({ page }) => {
  const errors = collectErrors(page);
  const body = page.locator('body');
  await page.goto('/?renderer=null&debug&play');
  await page.waitForFunction(() => '__glpAbandon' in window);
  await page.evaluate(() => (window as unknown as Hooks).__glpAbandon.founder());
  await expect(body).toHaveAttribute('data-danger', 'on');
  await expect(body).toHaveAttribute('data-danger-saved', /.+/);
  await page.evaluate(() => window.dispatchEvent(new Event('pagehide')));
  await page.goto('/?renderer=null&debug&play');
  await expect(body).toHaveAttribute('data-save', 'loaded');
  await expect(body).toHaveAttribute('data-danger-resumed', 'sea');
  await page.waitForFunction(() => '__glpAbandon' in window);
  await expect
    .poll(() => page.evaluate(() => (window as unknown as Hooks).__glpAbandon.leftS()))
    .toBeLessThan(45);
  expect(errors).toEqual([]);
});
