import { expect, test, type Page } from '@playwright/test';

/**
 * Phase 7 piece F, part one (plan 08 §20.4): the counters you trade at on foot in Bayfield.
 * The saloon's bar and the fence's table in its back room after dark, a shop's counter by
 * day, and a port screen that no longer keeps a Back room tab. Through the dev hooks.
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
  __glpPort: { open(port: string): void };
  __glpFoot: {
    land(): Promise<string | undefined>;
    dock(key: string): boolean;
    hour(h: number): void;
    interact(): void;
    teleportLocal(x: number, z: number, headingDeg?: number): boolean;
    state(): { active: boolean; prompt: string | undefined };
  };
}

const prompt = (page: Page) =>
  page.evaluate(() => (window as unknown as Hooks).__glpFoot.state().prompt);
const go = (page: Page, x: number, z: number) =>
  page.evaluate(
    ([a, b]) => (window as unknown as Hooks).__glpFoot.teleportLocal(a ?? 0, b ?? 0),
    [x, z],
  );
const interact = (page: Page) =>
  page.evaluate(() => (window as unknown as Hooks).__glpFoot.interact());

async function ashoreAt(page: Page, hour: number): Promise<void> {
  await page.goto('/?renderer=null&debug&play');
  await page.waitForFunction(() => '__glpFoot' in window);
  await page.evaluate((h) => {
    const f = (window as unknown as Hooks).__glpFoot;
    f.hour(h);
    f.dock('bayfield_city');
  }, hour);
}

test('after dark: a bottle at the bar, and the fence at his table in the back room', async ({
  page,
}) => {
  test.setTimeout(180_000);
  const errors = collectErrors(page);
  await ashoreAt(page, 22);
  // From the ship the room has no tab now: the saloon says where to find it.
  await page.evaluate(() => (window as unknown as Hooks).__glpPort.open('port.bayfield'));
  await expect(page.getByTestId('port-screen')).toBeVisible();
  await expect(page.getByTestId('port-tab-backRoom')).toHaveCount(0);
  await page.getByTestId('port-tab-saloon').click();
  await expect(page.getByTestId('back-room-hint')).toContainText('ashore');

  await page.keyboard.press('Escape');
  await expect(page.getByTestId('port-screen')).toHaveCount(0);
  expect(await page.evaluate(() => (window as unknown as Hooks).__glpFoot.land())).toBeUndefined();
  await expect(page.locator('body')).toHaveAttribute('data-ashore', 'foot');

  // The bar: the saloon's tab alone, under its name, and a bottle over the counter.
  expect(await go(page, 15.4, 13)).toBe(true);
  await expect.poll(() => prompt(page)).toBe('Stand at the bar');
  await interact(page);
  await expect(page.getByTestId('port-title')).toHaveText('Lake Superior Saloon');
  await expect(page.getByTestId('port-tab-saloon')).toBeVisible();
  await expect(page.getByTestId('port-tab-market')).toHaveCount(0);
  await expect(page.getByTestId('port-cast-off')).toHaveCount(0);
  const bottles = page.getByTestId('saloon-bottles');
  const before = Number((await bottles.textContent())?.match(/\d+/)?.[0]);
  await page.getByTestId('saloon-bottle').click();
  await expect(bottles).toContainText(`${before + 1} of`);
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('port-screen')).toHaveCount(0);
  await expect(page.locator('body')).toHaveAttribute('data-ashore', 'foot');

  // Through the partition: the fence and the shady shipwright, as the tab had them.
  expect(await go(page, 15.8, 19)).toBe(true);
  await expect.poll(() => prompt(page)).toBe('Deal with Nils Okerlund');
  await interact(page);
  await expect(page.getByTestId('back-room')).toBeVisible();
  await expect(page.getByTestId('port-title')).toContainText('the back room');
  await expect(page.getByTestId('shipwright')).toBeVisible();
  await page.getByTestId('port-close').click();
  await expect(page.locator('body')).toHaveAttribute('data-ashore', 'foot');
  expect((await page.evaluate(() => (window as unknown as Hooks).__glpFoot.state())).active).toBe(
    true,
  );
  expect(errors).toEqual([]);
});

test('by day: the general store trades across its counter, and the back room is empty', async ({
  page,
}) => {
  test.setTimeout(180_000);
  const errors = collectErrors(page);
  await ashoreAt(page, 10);
  expect(await page.evaluate(() => (window as unknown as Hooks).__glpFoot.land())).toBeUndefined();
  await expect(page.locator('body')).toHaveAttribute('data-ashore', 'foot');

  expect(await go(page, 73, 16.2)).toBe(true);
  await expect.poll(() => prompt(page)).toBe('Trade at Booth & Sons General Store');
  await interact(page);
  await expect(page.getByTestId('port-title')).toHaveText('Booth & Sons General Store');
  await expect(page.getByTestId('port-tab-market')).toBeVisible();
  await expect(page.getByTestId('port-tab-ledger')).toHaveCount(0);
  await page.keyboard.press('Escape');

  expect(await go(page, 15.8, 19)).toBe(true);
  // A few ticks on: still nobody at the table.
  await page.waitForTimeout(500);
  expect(await prompt(page)).toBeUndefined();
  expect(errors).toEqual([]);
});
