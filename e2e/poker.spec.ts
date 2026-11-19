import { expect, test, type Page } from '@playwright/test';

/**
 * Phase 9 piece C (plan 11 §18.3 criterion 5): a poker hand plays out at a saloon's card
 * table with a side stake changing hands; a palmed card seen ends in a brawl and the
 * table barred; and Bayfield's table is walked up to in the saloon. Through the dev hooks.
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
  __glpPort: { open(port: string): void; close(): void };
  __glpEconomy: { purse(): number; cargo(): unknown[] };
  __glpEvents: { fire(id: string, port?: string): unknown };
  __glpPoker: {
    give(cents: number): void;
    cheats(port: string, n: number): void;
    state(): { hands: number; barred: Record<string, number> };
  };
  __glpFoot: {
    land(): Promise<string | undefined>;
    dock(key: string): boolean;
    hour(h: number): void;
    interact(): void;
    teleportLocal(x: number, z: number, headingDeg?: number): boolean;
    state(): { active: boolean; prompt: string | undefined };
  };
}

const hooks = (page: Page) => page.evaluate(() => '__glpPoker' in window);

async function evening(page: Page): Promise<void> {
  await page.goto('/?renderer=null&debug&play');
  await page.waitForFunction(() => '__glpFoot' in window && '__glpPoker' in window);
  expect(await hooks(page)).toBe(true);
  await page.evaluate(() => {
    const w = window as unknown as Hooks;
    w.__glpFoot.hour(21);
    w.__glpPoker.give(500_000);
    // An empty hold, with room for whatever's won.
    w.__glpEconomy.cargo().length = 0;
  });
}

/** Plays the hand in front of you to its end: call or check every bet, stand pat. */
async function playOut(page: Page): Promise<void> {
  const table = page.getByTestId('card-table');
  for (let i = 0; i < 12; i++) {
    const phase = await table.getAttribute('data-phase');
    if (phase === 'done' || phase === 'over' || phase === 'caught') return;
    if (phase === 'draw') await page.getByTestId('card-draw').click();
    else if (await page.getByTestId('card-call').isVisible()) {
      await page.getByTestId('card-call').click();
    } else await page.getByTestId('card-check').click();
  }
}

test("plays a hand for a captain's marker at the card table", async ({ page }) => {
  test.setTimeout(120_000);
  const errors = collectErrors(page);
  await evening(page);
  // Poker night at Washburn: the big game, with a marker on the table.
  await page.evaluate(() => {
    const w = window as unknown as Hooks;
    w.__glpEvents.fire('event.poker_night', 'port.washburn');
    w.__glpPort.open('port.washburn');
  });
  await page.getByTestId('port-tab-saloon').click();
  await expect(page.getByTestId('cards-hint')).toContainText('big game');
  await page.getByTestId('port-tab-cards').click();
  const table = page.getByTestId('card-table');
  await expect(table).toHaveAttribute('data-phase', 'idle');
  await expect(page.getByTestId('card-offer')).toBeVisible();
  await page.getByTestId('card-stake').selectOption('cash');
  await page.getByTestId('card-deal').click();
  await expect(page.getByTestId('card-side')).toBeVisible();
  await expect(page.getByTestId('card-hand').locator('.playing-card')).toHaveCount(5);
  await playOut(page);
  await expect(table).toHaveAttribute('data-phase', /done|over/);
  // The side stake went one way or the other, and the log says so.
  await expect(page.getByTestId('card-log')).toContainText(/You win|takes|wash/);
  const st = await page.evaluate(() => (window as unknown as Hooks).__glpPoker.state());
  expect(st.hands).toBe(1);
  expect(errors).toEqual([]);
});

test('a palmed card seen ends in a brawl, and the table is barred', async ({ page }) => {
  test.setTimeout(120_000);
  const errors = collectErrors(page);
  await evening(page);
  await page.evaluate(() => (window as unknown as Hooks).__glpPort.open('port.washburn'));
  await page.getByTestId('port-tab-cards').click();
  const table = page.getByTestId('card-table');
  // Every eye at the table on you: one in ten goes unseen.
  await page.evaluate(() => (window as unknown as Hooks).__glpPoker.cheats('port.washburn', 20));
  for (let hand = 0; hand < 8; hand++) {
    if ((await table.getAttribute('data-phase')) === 'caught') break;
    await page.getByTestId('card-deal').click();
    for (let i = 0; i < 12; i++) {
      const phase = await table.getAttribute('data-phase');
      if (phase !== 'bet1' && phase !== 'draw') break;
      if (phase === 'draw') {
        await page.getByTestId('card-0').click();
        await page.getByTestId('card-palm').check();
        await page.getByTestId('card-draw').click();
      } else if (await page.getByTestId('card-call').isVisible()) {
        await page.getByTestId('card-call').click();
      } else await page.getByTestId('card-check').click();
    }
    if ((await table.getAttribute('data-phase')) === 'caught') break;
    await playOut(page);
  }
  await expect(table).toHaveAttribute('data-phase', 'caught');
  await expect(page.getByTestId('card-caught')).toContainText('has your wrist');
  await page.getByTestId('card-swing').click();
  await expect(page.getByTestId('port-message')).toContainText('fight your way');
  const st = await page.evaluate(() => (window as unknown as Hooks).__glpPoker.state());
  expect(st.barred['port.washburn']).toBeGreaterThan(0);
  // Back at the bar, you're told you're not welcome; the table's tab is gone.
  await page.getByTestId('port-tab-saloon').click();
  await expect(page.getByTestId('cards-hint')).toContainText('not welcome');
  await expect(page.getByTestId('port-tab-cards')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("Bayfield's card table is walked up to in the saloon", async ({ page }) => {
  test.setTimeout(180_000);
  const errors = collectErrors(page);
  await evening(page);
  await page.evaluate(() => (window as unknown as Hooks).__glpFoot.dock('bayfield_city'));
  // From the ship there's no tab: the saloon says where the game is.
  await page.evaluate(() => (window as unknown as Hooks).__glpPort.open('port.bayfield'));
  await expect(page.getByTestId('port-tab-cards')).toHaveCount(0);
  await page.getByTestId('port-tab-saloon').click();
  await expect(page.getByTestId('cards-hint')).toContainText('go ashore');
  await page.keyboard.press('Escape');
  expect(await page.evaluate(() => (window as unknown as Hooks).__glpFoot.land())).toBeUndefined();
  await expect(page.locator('body')).toHaveAttribute('data-ashore', 'foot');
  expect(
    await page.evaluate(() => (window as unknown as Hooks).__glpFoot.teleportLocal(16.9, 14.5)),
  ).toBe(true);
  await expect
    .poll(() => page.evaluate(() => (window as unknown as Hooks).__glpFoot.state().prompt))
    .toBe('Sit in at the card table');
  await page.evaluate(() => (window as unknown as Hooks).__glpFoot.interact());
  await expect(page.getByTestId('port-title')).toContainText('the card table');
  await expect(page.getByTestId('card-table')).toBeVisible();
  await expect(page.getByTestId('port-tab-market')).toHaveCount(0);
  expect(errors).toEqual([]);
});
