import { expect, test } from '@playwright/test';

/**
 * Phase 9 piece L (plan 11 §18.4): winter's look. Without a renderer the hook still reads
 * the look's sim side: summer is bare, February is white and wintry, and the jump puts the
 * clock on a date and hour without errors. The drawn look is checked by eye (render shots).
 */

interface Hooks {
  __glpWinter: {
    state(): {
      date: string;
      snow: { depthCm: number; cover01: number };
      look: number;
      aurora: number;
      airC: number;
    };
    jump(iso: string, hour?: number): string;
  };
}

test('the year turns white: snow and the winter palette by date', async ({ page }) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/?renderer=null&debug&harbor=bayfield');
  await expect(page.locator('body')).toHaveAttribute('data-mode', 'sailing', { timeout: 30_000 });
  await page.waitForFunction(() => '__glpWinter' in window);

  const summer = await page.evaluate(() => (window as unknown as Hooks).__glpWinter.state());
  expect(summer.snow.cover01).toBe(0);
  expect(summer.look).toBe(0);

  const date = await page.evaluate(() =>
    (window as unknown as Hooks).__glpWinter.jump('1901-02-10', 13),
  );
  expect(date).toMatch(/^1901-02-/);
  const winter = await page.evaluate(() => (window as unknown as Hooks).__glpWinter.state());
  expect(winter.snow.cover01).toBeGreaterThan(0.5);
  expect(winter.look).toBeGreaterThan(0.7);
  expect(winter.airC).toBeLessThan(2);
  expect(errors).toEqual([]);
});
