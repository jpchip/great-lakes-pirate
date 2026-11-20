import { expect, test, type Page } from '@playwright/test';

/**
 * Phase 9 piece B: the nickname and the endings. Deeds the papers name you for and a little
 * Fame give you a name in the papers and on the WANTED column; a land agent's letter at the
 * harbor master's retires the run to a cabin on Sand Island, with its page and epilogue; and
 * the Hall of Captains on the main menu keeps the run through a reload and a new captain.
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
  __glpLaw: { setFame(value: number): void };
  __glpPoker: { give(cents: number): number };
  __glpNickname: {
    deed(crime: string, n?: number): void;
    check(): { from?: string; to: string } | undefined;
    current(): string | undefined;
  };
  __glpEndings: { offer(kind: 'retire' | 'lawman', force?: boolean): boolean };
  __glpStash: { open(): void; stashCash(c: number): unknown; close(): void };
}

test('the papers name you, the land agent retires you, and the Hall keeps you', async ({
  page,
}) => {
  test.setTimeout(120_000);
  const errors = collectErrors(page);
  await page.goto('/?renderer=null&debug&play');
  await expect(page.locator('body')).toHaveAttribute('data-terrain', 'loaded');
  await page.waitForFunction(() => '__glpNickname' in window && '__glpEndings' in window);

  // Smuggling the papers know of, and Fame enough to be talked of (Rumored): a name.
  const nick = await page.evaluate(() => {
    const n = (window as unknown as Hooks).__glpNickname;
    n.deed('crime.contraband', 4);
    n.check();
    return n.current();
  });
  expect(nick).toBeUndefined();
  await page.evaluate(() => (window as unknown as Hooks).__glpLaw.setFame(60));
  const coined = await page.evaluate(() => {
    const n = (window as unknown as Hooks).__glpNickname;
    n.check();
    return n.current();
  });
  expect(coined).toBeTruthy();

  // Money enough to come ashore, put by in the strongbox (as the wealth Ambition counts it),
  // and the land agent's letter.
  const offered = await page.evaluate(() => {
    const w = window as unknown as Hooks;
    w.__glpPoker.give(1_100_000);
    w.__glpStash.open();
    w.__glpStash.stashCash(1_000_000);
    w.__glpStash.close();
    return w.__glpEndings.offer('retire');
  });
  expect(offered).toBe(true);
  await page.evaluate(() => (window as unknown as Hooks).__glpPort.dock('bayfield_city'));
  await expect(page.getByTestId('port-screen')).toBeVisible({ timeout: 15_000 });
  await page.getByTestId('port-tab-harbor').click();
  const editor = page.getByTestId('harbor-letter').filter({ hasText: 'The Editor' });
  await expect(editor).toHaveCount(1);
  const letter = page.getByTestId('harbor-letter').filter({ hasText: 'Coming ashore' });
  await letter.locator('summary').click();
  await expect(letter).toContainText('Sand Island');
  await letter.getByTestId('letter-choice-retire_cabin').click();

  const end = page.getByTestId('end-screen');
  await expect(end).toHaveAttribute('data-cause', 'retired');
  await expect(page.getByTestId('front-headline')).toHaveText(
    `${(coined ?? '').toUpperCase()} GONE TO THE ISLANDS`,
  );
  await expect(page.getByTestId('end-epilogue')).toContainText('island');
  await expect(page.getByTestId('end-nickname')).toContainText(coined ?? '');

  // The Hall of Captains, on the menu, after a reload and with a new captain started.
  await page.getByTestId('end-menu').click();
  await expect(page.getByTestId('main-menu')).toBeVisible();
  await page.getByTestId('menu-hall').click();
  const entry = page.getByTestId('hall-entry').first();
  await expect(entry).toContainText('Went to ground on Sand Island');
  await expect(entry.getByTestId('hall-nickname')).toContainText(coined ?? '');
  await page.reload();
  await page.getByTestId('menu-hall').click();
  await expect(page.getByTestId('hall-entry').first()).toContainText('Sand Island');
  await entry.locator('button').click();
  await expect(page.getByTestId('hall-detail')).toContainText('Retired to a cabin on Sand Island');
  await page.getByTestId('hall-back').click();
  await page.getByTestId('menu-new-run').click();
  await page.getByTestId('create-start').click();
  await expect(page.locator('body')).toHaveAttribute('data-terrain', 'loaded', { timeout: 30_000 });
  await page.goto('/?renderer=null');
  await page.getByTestId('menu-hall').click();
  await expect(page.getByTestId('hall-entry')).toHaveCount(1);
  expect(errors).toEqual([]);
});
