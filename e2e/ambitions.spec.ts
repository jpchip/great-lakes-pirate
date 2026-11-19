import { expect, test, type Page } from '@playwright/test';

/**
 * Phase 8 piece H (plan 09 §16.4, plan 12 §4.1): Ambitions. Pin up to three in the
 * journal's Ambitions page and follow them on the HUD; one met pays its reward, leaves a
 * themed mark in the ledger that can be cleared, and the papers hear of it.
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
  __glpZones: { enter(id: string): void };
  __glpAmbitions: { stash(cents: number): string[] };
  __glpEconomy: { purse(): number };
  __glpPapers: { state(): { stories: { kind: string; ambition?: string }[] } };
}

test('pins three ambitions, follows them on the HUD, and earns a mark', async ({ page }) => {
  const errors = collectErrors(page);
  const body = page.locator('body');
  await page.goto('/?renderer=null&play&debug');
  await page.waitForFunction(() => '__glpZones' in window && '__glpAmbitions' in window);
  await page.evaluate(() => (window as unknown as Hooks).__glpZones.enter('zone.apostles'));
  await expect(body).toHaveAttribute('data-zone-load', 'done');
  await expect(page.getByTestId('ambitions-tracker')).toHaveCount(0);

  // The journal's Ambitions page: pin three, and a fourth is refused.
  await page.keyboard.press('KeyJ');
  await page.getByTestId('ledger-tab-ambitions').click();
  const page_ = page.getByTestId('ledger-ambitions');
  await expect(page_).toBeVisible();
  const row = (id: string) => page_.locator(`[data-ambition-id="${id}"]`);
  await row('ambition.nest_egg').getByTestId('ambition-pin').click();
  await row('ambition.slipped_the_morrill').getByTestId('ambition-pin').click();
  await row('ambition.on_time_25').getByTestId('ambition-pin').click();
  await expect(row('ambition.legendary').getByTestId('ambition-pin')).toBeDisabled();
  await expect(row('ambition.nest_egg')).toHaveClass(/pinned/);
  await page.keyboard.press('KeyJ');

  // On the HUD, with the progress of each, and it folds.
  const tracker = page.getByTestId('ambitions-tracker');
  await expect(tracker.getByTestId('ambition-pinned')).toHaveCount(3);
  await expect(tracker).toContainText('$0 of $1,000');
  await page.getByTestId('ambitions-fold').click();
  await expect(tracker.getByTestId('ambition-pinned')).toHaveCount(0);
  await page.getByTestId('ambitions-fold').click();
  await expect(tracker.getByTestId('ambition-pinned')).toHaveCount(3);

  // A thousand dollars in the strongbox: done, paid, unpinned, in the papers.
  const before = await page.evaluate(() => (window as unknown as Hooks).__glpEconomy.purse());
  const done = await page.evaluate(() =>
    (window as unknown as Hooks).__glpAmbitions.stash(100_000),
  );
  expect(done).toEqual(['ambition.nest_egg']);
  const after = await page.evaluate(() => (window as unknown as Hooks).__glpEconomy.purse());
  expect(after - before).toBe(2_500);
  await expect(page.getByTestId('ambition-just-done')).toContainText('A nest egg');
  await expect(tracker.getByTestId('ambition-pinned')).toHaveCount(2);
  const stories = await page.evaluate(() =>
    (window as unknown as Hooks).__glpPapers.state().stories.filter((s) => s.kind === 'ambition'),
  );
  expect(stories.map((s) => s.ambition)).toEqual(['ambition.nest_egg']);

  // Its mark in the ledger, cleared.
  await page.keyboard.press('KeyJ');
  await page.getByTestId('ledger-tab-ambitions').click();
  const mark = page.getByTestId('ambition-mark');
  await expect(mark).toHaveCount(1);
  await expect(mark).toContainText('A bank draft');
  await mark.getByTestId('ambition-clear').click();
  await expect(mark).toHaveCount(0);
  await expect(page_).toContainText('1 of 15 done');
  expect(errors).toEqual([]);
});
