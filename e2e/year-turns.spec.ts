import { expect, test } from '@playwright/test';

/**
 * Phase 9 piece K (plan 11 §18.3 criterion 10): the year turns. Run the clock from May on
 * into January at Duluth: the harbor freezes in, the harbor master offers to lay her up,
 * and laying up passes the winter to the ice-out, the harbor open again.
 */

interface Hooks {
  __glpIce: {
    skipTo(iso: string): string;
    harbor(port: string): { closed: boolean; freezeUp?: string; iceOut?: string };
    state(): { frozen: string[] };
    at(lon: number, lat: number): { coverage: number; thicknessCm: number; kind: string };
  };
  __glpPort: { open(port: string): void; docked(): string | undefined };
}

test('Duluth freezes in, and laying up there runs on to its ice-out', async ({ page }) => {
  test.setTimeout(180_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const body = page.locator('body');
  await page.goto('/?renderer=null&debug&harbor=duluth');
  await expect(body).toHaveAttribute('data-mode', 'sailing', { timeout: 30_000 });
  await page.waitForFunction(() => '__glpIce' in window && '__glpPort' in window);

  // Summer: open water and an open harbor.
  const summer = await page.evaluate(() =>
    (window as unknown as Hooks).__glpIce.harbor('port.duluth'),
  );
  expect(summer.closed).toBe(false);
  expect(summer.freezeUp).toMatch(/-(11|12|01)-/);

  // Into the winter: Duluth is frozen in, and Chequamegon Bay is fast ice.
  await page.evaluate(() => (window as unknown as Hooks).__glpIce.skipTo('1901-02-01'));
  const winter = await page.evaluate(() => {
    const w = window as unknown as Hooks;
    return {
      harbor: w.__glpIce.harbor('port.duluth'),
      frozen: w.__glpIce.state().frozen,
      bay: w.__glpIce.at(-90.85, 46.62),
    };
  });
  expect(winter.harbor.closed).toBe(true);
  expect(winter.frozen).toContain('port.duluth');
  expect(winter.bay.kind).toBe('fast');

  // The harbor master says when the ice goes out, and lays her up until then.
  await page.evaluate(() => (window as unknown as Hooks).__glpPort.open('port.duluth'));
  await page.getByTestId('port-tab-harbor').click();
  await expect(page.getByTestId('harbor-frozen')).toContainText(/about (March|April|May) \d+/);
  await page.getByTestId('harbor-lay-up').click();
  await expect(page.locator('body')).toContainText('The winter passes ashore');
  const spring = await page.evaluate(() =>
    (window as unknown as Hooks).__glpIce.harbor('port.duluth'),
  );
  expect(spring.closed).toBe(false);
  expect(errors).toEqual([]);
});
