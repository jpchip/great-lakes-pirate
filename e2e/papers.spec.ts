import { expect, test, type Page } from '@playwright/test';

/**
 * Phase 5 piece F (plan 06 §14.3 criteria 6 and 11): the newsstand on the port screen, the
 * papers printing what happened, the tier-5 front page, and the harbor master's fine paid
 * from his tab.
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
  __glpLaw: {
    commit(crime: string, region?: string, kind?: string, identification?: string): void;
    fileAll(): void;
    setTier(region: string, tier: number): void;
    state(): { wanted: Record<string, { heat: number }>; fame: { value: number } };
  };
  __glpPapers: { press(): unknown };
  __glpEconomy: { purse(): number };
}

test('reads the papers in port, and Most Wanted fills the screen', async ({ page }) => {
  const errors = collectErrors(page);
  const body = page.locator('body');
  await page.goto('/?renderer=null&debug&harbor=bayfield');
  await expect(body).toHaveAttribute('data-terrain', 'loaded');
  await page.waitForFunction(() => '__glpPapers' in window);

  // A crime named to you, filed, then the morning's papers.
  await page.evaluate(() => {
    const w = window as unknown as Hooks;
    w.__glpLaw.commit('crime.contract_theft', 'region.chequamegon', 'freightAgent', 'person');
    w.__glpLaw.fileAll();
  });
  await page.evaluate(() => (window as unknown as Hooks).__glpPapers.press());
  const fame = await page.evaluate(() => (window as unknown as Hooks).__glpLaw.state().fame.value);
  expect(fame).toBeGreaterThan(5);

  await page.evaluate(() => (window as unknown as Hooks).__glpPort.dock('bayfield_city'));
  const screen = page.getByTestId('port-screen');
  await expect(screen).toBeVisible({ timeout: 15_000 });
  await page.getByTestId('port-tab-papers').click();
  await page.getByTestId('paper-pick-paper.bayfield_weekly').click();
  await expect(page.getByTestId('paper-headline')).toContainText('STOLEN');
  const before = await page.evaluate(() => (window as unknown as Hooks).__glpEconomy.purse());
  await page.getByTestId('paper-buy').click();
  await expect(page.getByTestId('paper-page')).toHaveAttribute('data-read', 'true');
  await expect(page.getByTestId('paper-wanted')).toBeVisible();
  await expect(page.getByTestId('paper-weather')).toContainText('Bayfield and vicinity');
  const after = await page.evaluate(() => (window as unknown as Hooks).__glpEconomy.purse());
  expect(before - after).toBe(2);

  // The harbor master takes the fine from his tab.
  await page.getByTestId('port-tab-harbor').click();
  await page.getByTestId('harbor-fine').click();
  const heat = await page.evaluate(
    () => (window as unknown as Hooks).__glpLaw.state().wanted['region.chequamegon']?.heat ?? 0,
  );
  expect(heat).toBe(0);

  // Most Wanted: the front page over everything, once, and the game waits behind it.
  await page.evaluate(() => (window as unknown as Hooks).__glpLaw.setTier('region.chequamegon', 5));
  const front = page.getByTestId('most-wanted-page');
  await expect(front).toBeVisible();
  await expect(page.getByTestId('most-wanted-headline')).toHaveText('WANTED: DEAD OR ALIVE');
  await expect(body).toHaveAttribute('data-front-page', 'region.chequamegon');
  await page.getByTestId('most-wanted-close').click();
  await expect(front).toBeHidden();
  await expect(screen).toBeVisible();
  expect(errors).toEqual([]);
});
