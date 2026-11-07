import { expect, test, type Page } from '@playwright/test';

/**
 * Phase 5 piece D (plan 06 §14.3 criteria 8 and 9): capture, the lockup, bail, the rope,
 * the end screen, the danger snapshot and the single-tab lock, through the dev hooks.
 */

function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });
  return errors;
}

interface JailState {
  tier: number;
  sentenceWeeks: number;
  execution: boolean;
  releaseAt: number;
  confiscated: { cargo: { good: string; qty: number }[]; cashCents: number };
  word?: { arrivesAt: number };
}
interface CaptureHook {
  capture(region?: string, how?: 'surrender' | 'boarded'): void;
  state(): JailState | null;
  record(): { stats: { captures: number }; logbook: { text: string }[] };
  danger(): { inDanger: boolean };
  abandon(): Promise<void>;
}
interface LawHook {
  setTier(region: string, tier: number): void;
  state(): { wanted: Record<string, { heat: number }> };
}
interface Hooks {
  __glpCapture: CaptureHook;
  __glpLaw: LawHook;
  __glpZones: { clock(): number };
  __glpEconomy: { purse(): number; cargo(): { good: string; qty: number }[] };
  __glpPort: { docked(): string | undefined };
  __glpStash: { hideouts(): Record<string, { storage: { cash: number } }> };
}
async function boot(page: Page, query = ''): Promise<void> {
  await page.goto(`/?renderer=null&debug&play${query}`);
  await expect(page.locator('body')).toHaveAttribute('data-terrain', 'loaded');
  await page.waitForFunction(() => '__glpCapture' in window && '__glpLaw' in window);
}

/** Sets a region's tier, then the Morrill takes the ship there. */
async function takenAt(page: Page, region: string, tier: number): Promise<void> {
  await page.evaluate(
    ([r, t]) => {
      const w = window as unknown as Hooks;
      w.__glpLaw.setTier(r as string, t as number);
      w.__glpCapture.capture(r as string);
    },
    [region, tier],
  );
}

const APOSTLES = 'region.apostles';

test('captured below tier 5: cargo and cash taken, the sentence served, the ship back at Bayfield', async ({
  page,
}) => {
  const errors = collectErrors(page);
  const body = page.locator('body');
  await boot(page);
  const before = await page.evaluate(() => {
    const w = window as unknown as Hooks;
    return { purse: w.__glpEconomy.purse(), clock: w.__glpZones.clock() };
  });
  expect(before.purse).toBeGreaterThan(0);

  await takenAt(page, APOSTLES, 2);
  const screen = page.getByTestId('jail-screen');
  await expect(screen).toHaveAttribute('data-kind', 'cell');
  await expect(page.getByTestId('jail-sentence')).toHaveText(/^[23] weeks$/);
  await expect(page.getByTestId('jail-confiscated')).toContainText('in cash');
  const jailed = await page.evaluate(() => {
    const w = window as unknown as Hooks;
    return { jail: w.__glpCapture.state(), purse: w.__glpEconomy.purse(), cargo: w.__glpEconomy.cargo() };
  });
  expect(jailed.purse).toBe(0);
  expect(jailed.cargo).toEqual([]);
  expect(jailed.jail?.confiscated.cashCents).toBe(before.purse);

  // The lockup is saved at once: a reload comes back to the cell.
  await page.waitForTimeout(300);
  await boot(page);
  await expect(body).toHaveAttribute('data-save', 'loaded');
  await expect(page.getByTestId('jail-screen')).toHaveAttribute('data-kind', 'cell');
  // Esc doesn't get you out.
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('jail-screen')).toBeVisible();

  // The jailbreak isn't built yet.
  await page.getByTestId('jail-break').click();
  await expect(screen).toContainText('later version');

  await page.getByTestId('jail-serve').click();
  await expect(screen).toHaveAttribute('data-kind', 'released');
  await expect(page.getByTestId('jail-inside')).toContainText("It's the week of");
  const out = await page.evaluate(() => {
    const w = window as unknown as Hooks;
    return {
      jail: w.__glpCapture.state(),
      clock: w.__glpZones.clock(),
      heat: w.__glpLaw.state().wanted['region.apostles']?.heat ?? 0,
      record: w.__glpCapture.record(),
    };
  });
  expect(out.jail).toBeNull();
  // Two or three weeks skipped (a game day each), plus any fee worked off.
  expect(out.clock - before.clock).toBeGreaterThanOrEqual(2 * 86_400);
  expect(out.heat).toBeGreaterThanOrEqual(20);
  expect(out.heat).toBeLessThan(60);
  expect(out.record.stats.captures).toBe(1);
  expect(out.record.logbook.map((l) => l.text).join('\n')).toContain('Locked up at Bayfield');

  // Back aboard: alongside Bayfield's city dock, the port screen up.
  await page.getByTestId('jail-leave').click();
  await expect(page.getByTestId('port-screen')).toHaveAttribute('data-port', 'port.bayfield', {
    timeout: 20_000,
  });
  await expect(body).toHaveAttribute('data-jail', 'closed');
  expect(errors).toEqual([]);
});

test('bail sent for from the Stockton strongbox lets the captain out early', async ({ page }) => {
  const errors = collectErrors(page);
  await boot(page);
  // Money in the strongbox first: open the stash wherever she is and put a purse in.
  await page.evaluate(() => {
    const w = window as unknown as {
      __glpShipyard: { grant(c: number): void };
      __glpStash: { open(): void; stashCash(c: number): unknown; close(): void };
    };
    w.__glpShipyard.grant(1_000_000);
    w.__glpStash.open();
    w.__glpStash.stashCash(900_000);
    w.__glpStash.close();
  });
  await takenAt(page, APOSTLES, 4);
  await expect(page.getByTestId('jail-sentence')).toHaveText(/^(8|9|10|11|12) weeks$/);
  const sentence = await page.evaluate(() => (window as unknown as Hooks).__glpCapture.state());
  await page.getByTestId('jail-word-hideout.stockton').click();
  await expect(page.getByTestId('jail-screen')).toHaveAttribute('data-kind', 'released');
  await expect(page.getByTestId('jail-lead')).toContainText('still wants you');
  const after = await page.evaluate(() => {
    const w = window as unknown as Hooks;
    return {
      clock: w.__glpZones.clock(),
      heat: w.__glpLaw.state().wanted['region.apostles']?.heat ?? 0,
      cash: w.__glpStash.hideouts()['hideout.stockton']?.storage.cash ?? 0,
    };
  });
  // Out in a day or so, well before the sentence, with the heat as it was (less a day's decay).
  expect(after.clock).toBeLessThan(sentence?.releaseAt ?? 0);
  expect(after.heat).toBeGreaterThan(250);
  expect(after.cash).toBeLessThan(900_000);
  expect(errors).toEqual([]);
});

test('captured at tier 5: the gallows, the end screen, and the run is gone', async ({ page }) => {
  const errors = collectErrors(page);
  const body = page.locator('body');
  await boot(page);
  await takenAt(page, APOSTLES, 5);
  const screen = page.getByTestId('jail-screen');
  await expect(screen).toHaveAttribute('data-kind', 'gallows');
  await page.getByTestId('jail-break').click();
  await expect(screen).toContainText('ONE CHANCE');
  await page.getByTestId('jail-hang').click();

  await expect(page.getByTestId('end-screen')).toHaveAttribute('data-cause', 'executed');
  await expect(page.getByTestId('front-headline')).toContainText('HANGED AT BAYFIELD');
  await expect(page.getByTestId('run-summary')).toContainText('Never killed a soul');
  await expect(body).toHaveAttribute('data-run', 'ended');
  const download = page.waitForEvent('download');
  await page.getByTestId('end-logbook').click();
  expect((await download).suggestedFilename()).toMatch(/^logbook-.+\.md$/);
  // Nothing saves the run again, even when the tab goes.
  await page.evaluate(() => window.dispatchEvent(new Event('pagehide')));

  // The menu: nothing to continue, the last run's front page to read.
  await page.getByTestId('end-menu').click();
  await expect(page.getByTestId('main-menu')).toBeVisible();
  await expect(page.getByTestId('menu-continue')).toHaveCount(0);
  await expect(page.getByTestId('last-run')).toContainText('Hanged at Bayfield');
  await page.getByTestId('menu-last-run').click();
  await expect(page.getByTestId('front-headline')).toContainText('HANGED');
  await page.getByTestId('end-menu').click();
  await expect(page.getByTestId('main-menu')).toBeVisible();
  // A new captain clears it, and is warned first that there's one life.
  await page.getByTestId('menu-new-run').click();
  await expect(page.getByTestId('create-permadeath')).toContainText('One life');
  expect(errors).toEqual([]);
});

test('abandoning the run from the pause menu ends it', async ({ page }) => {
  const errors = collectErrors(page);
  await boot(page);
  await page.getByTestId('open-settings').click();
  await page.getByTestId('settings-abandon').click();
  await page.getByTestId('settings-abandon-confirm').click();
  await expect(page.getByTestId('end-screen')).toHaveAttribute('data-cause', 'abandoned');
  await page.goto('/?renderer=null');
  await expect(page.getByTestId('main-menu')).toBeVisible();
  await expect(page.getByTestId('menu-continue')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('closing the tab mid-chase resumes from the danger snapshot', async ({ page }) => {
  const errors = collectErrors(page);
  const body = page.locator('body');
  await boot(page);
  // A hunt begins (piece C raises it; the chart lock's dev switch stands in here).
  await page.evaluate(() =>
    (window as unknown as { __glpChart: { setPursued(on: boolean): void } }).__glpChart.setPursued(true),
  );
  await expect(body).toHaveAttribute('data-danger', 'on');
  await expect(body).toHaveAttribute('data-danger-saved', /.+/);
  // The tab goes mid-chase: the regular save is held back, and the reload is the snapshot.
  await page.evaluate(() => window.dispatchEvent(new Event('pagehide')));
  await page.goto('/?renderer=null&debug&play');
  await expect(body).toHaveAttribute('data-save', 'loaded');
  await expect(body).toHaveAttribute('data-danger-resumed', 'law.morrill');
  await expect(body).toHaveAttribute('data-arena', 'cutter', { timeout: 20_000 });
  expect(errors).toEqual([]);
});

test('a second tab is turned away while the game is open', async ({ page, context }) => {
  const errors = collectErrors(page);
  await boot(page);
  const second = await context.newPage();
  await second.goto('/?renderer=null&debug&play');
  await expect(second.getByTestId('tab-locked')).toBeVisible();
  await expect(second.locator('body')).toHaveAttribute('data-tab-lock', 'blocked');
  // The first plays on; once it's closed, the second can have the run.
  await page.close();
  await second.reload();
  await expect(second.locator('body')).toHaveAttribute('data-tab-lock', 'held');
  expect(errors).toEqual([]);
});
