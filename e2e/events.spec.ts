import { expect, test, type Page } from '@playwright/test';

/**
 * Phase 9 piece A (plan 11 §18.3 criteria 1 and 2): a letter waits at the harbor master's,
 * is read there and carries an event's choice; a scene plays on the pier; a meeting at sea
 * stops a voyage on the chart.
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
  __glpPort: { dock(key: string): boolean };
  __glpLaw: { setTier(region: string, tier: number): void };
  __glpEconomy: { purse(): number };
  __glpEvents: {
    fire(id: string, port?: string): unknown;
    state(): { active: { id: string; chosen?: string }[] };
  };
  __glpChart: { plot(points: [number, number][]): string };
}

test('reads a letter at the harbor master and answers it', async ({ page }) => {
  const errors = collectErrors(page);
  const body = page.locator('body');
  await page.goto('/?renderer=null&debug&harbor=bayfield');
  await expect(body).toHaveAttribute('data-terrain', 'loaded');
  await page.waitForFunction(() => '__glpEvents' in window);

  // Wanted in the Apostles, with the Stockton hideout: an informant writes.
  await page.evaluate(() => {
    const w = window as unknown as Hooks;
    w.__glpLaw.setTier('region.apostles', 1);
    w.__glpEvents.fire('event.informant');
    w.__glpEvents.fire('event.camp_demand', 'port.ashland');
  });

  await page.evaluate(() => (window as unknown as Hooks).__glpPort.dock('bayfield_city'));
  const screen = page.getByTestId('port-screen');
  await expect(screen).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId('letter-badge')).toHaveText('2');
  await page.getByTestId('port-tab-harbor').click();
  const letters = page.getByTestId('harbor-letter');
  await expect(letters).toHaveCount(2);

  // The newest first: the foreman's.
  await letters.nth(0).locator('summary').click();
  await expect(letters.nth(0)).toContainText('Provisions wanted');
  await expect(page.getByTestId('letter-badge')).toHaveText('1');

  await letters.nth(1).locator('summary').click();
  await expect(letters.nth(1)).toContainText('Somebody is talking');
  await expect(page.getByTestId('letter-badge')).toBeHidden();
  const before = await page.evaluate(() => (window as unknown as Hooks).__glpEconomy.purse());
  await page.getByTestId('letter-choice-pay').click();
  await expect(page.getByTestId('harbor-letter-result')).toContainText('plain envelope');
  const after = await page.evaluate(() => (window as unknown as Hooks).__glpEconomy.purse());
  expect(before - after).toBe(4000);
  await expect(page.getByTestId('letter-choice-pay')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('plays a scene on the pier', async ({ page }) => {
  const errors = collectErrors(page);
  const body = page.locator('body');
  await page.goto('/?renderer=null&debug&harbor=bayfield');
  await expect(body).toHaveAttribute('data-terrain', 'loaded');
  await page.waitForFunction(() => '__glpEvents' in window);

  // An idle crew on the pier at Bayfield.
  await page.evaluate(() =>
    (window as unknown as Hooks).__glpEvents.fire('event.whiskey_hijack', 'port.bayfield'),
  );
  const scene = page.getByTestId('event-scene');
  await expect(scene).toBeVisible();
  await expect(scene).toHaveAttribute('data-kind', 'scene');
  await expect(body).toHaveAttribute('data-event-scene', 'open');
  await page.getByTestId('event-choice-stand').click();
  await expect(page.getByTestId('event-scene-result')).toContainText('two dollars');
  await page.getByTestId('event-scene-close').click();
  await expect(scene).toBeHidden();
  await expect(body).toHaveAttribute('data-event-scene', 'closed');
  const chosen = await page.evaluate(() =>
    (window as unknown as Hooks).__glpEvents
      .state()
      .active.find((a) => a.id === 'event.whiskey_hijack'),
  );
  expect(chosen?.chosen).toBe('stand');
  expect(errors).toEqual([]);
});

test('stops a voyage for a lifeboat adrift', async ({ page }) => {
  const errors = collectErrors(page);
  const body = page.locator('body');
  await page.goto('/?renderer=null&debug&zone=zone.apostles&spawn=-3350,-2450,270');
  await expect(page.getByTestId('take-to-chart')).toBeVisible();
  await page.getByTestId('take-to-chart').click();
  await expect(body).toHaveAttribute('data-mode', 'chart');
  await page.evaluate(() =>
    (window as unknown as Hooks).__glpChart.plot([
      [46.97, -91.6],
      [46.85, -91.95],
    ]),
  );
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('chart-status')).toContainText('Under way');

  await page.evaluate(() => (window as unknown as Hooks).__glpEvents.fire('event.wreck_survivors'));
  const scene = page.getByTestId('event-scene');
  await expect(scene).toBeVisible();
  await expect(scene).toHaveAttribute('data-kind', 'chart');
  await expect(scene).toContainText('A lifeboat adrift');
  await page.getByTestId('event-choice-rescue').click();
  await page.getByTestId('event-scene-close').click();
  await expect(scene).toBeHidden();
  await expect(page.getByTestId('chart-status')).toContainText('Under way');
  expect(errors).toEqual([]);
});
