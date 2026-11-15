import { expect, test, type Page } from '@playwright/test';

/**
 * Phase 7 piece G (plan 08 §9, §20.3 #7): the jailbreak. From the cell in Bayfield's
 * lockup a promise to the jailer opens the door, and aboard your ship at the city dock
 * you're free with the jailbreak on your name; a reload in the middle of an attempt loses
 * it; and at tier 5 it is the one chance in irons, with the rope at dawn. Through the dev
 * hooks.
 */

function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });
  return errors;
}

interface Jail {
  tier: number;
  sentenceWeeks: number;
  execution: boolean;
  breakout: { attempts: number; active: boolean };
}
interface Breakout {
  inCell: boolean;
  doorOpen: boolean;
  inIrons: boolean;
  jailer?: { state: string; x: number; z: number; waitS: number };
  banner?: { text: string; oneChance: boolean };
}
interface Hooks {
  __glpCapture: {
    capture(region?: string): void;
    state(): Jail | null;
    breakingOut(): boolean;
    debt(): { cents: number; dueAt: number } | undefined;
    record(): { logbook: { text: string }[] };
  };
  __glpLaw: {
    setTier(region: string, tier: number): void;
    state(): {
      wanted: Record<string, { heat: number }>;
      reports: { crimes: { crime: string }[]; inProgress: { identification: string }[] };
    };
  };
  __glpFoot: {
    hour(h: number): void;
    interact(): void;
    suspect(on: boolean | undefined): void;
    teleportLocal(x: number, z: number, headingDeg?: number): boolean;
    state(): { prompt: string | undefined; mooring: string };
    tools(): { offer?: string };
    heist(): { stow?: { x: number; z: number } };
    jailbreak(): Breakout | undefined;
  };
}

const APOSTLES = 'region.apostles';

async function boot(page: Page): Promise<void> {
  await page.goto('/?renderer=null&debug&play&seed=glp-2');
  await expect(page.locator('body')).toHaveAttribute('data-terrain', 'loaded');
  await page.waitForFunction(() => '__glpCapture' in window && '__glpFoot' in window);
}

/** Taken by the Morrill with the region at `tier`, and the jailbreak begun from the screen. */
async function breakOutAt(page: Page, tier: number): Promise<void> {
  await page.evaluate(
    ([r, t]) => {
      const w = window as unknown as Hooks;
      w.__glpLaw.setTier(r as string, t as number);
      w.__glpCapture.capture(r as string);
    },
    [APOSTLES, tier],
  );
  await expect(page.getByTestId('jail-screen')).toBeVisible();
  await page.getByTestId('jail-break').click();
  await expect(page.locator('body')).toHaveAttribute('data-ashore', 'foot', { timeout: 30_000 });
  await expect(page.getByTestId('jail-screen')).toHaveCount(0);
}

const breakout = (page: Page) =>
  page.evaluate(() => (window as unknown as Hooks).__glpFoot.jailbreak());
const offer = (page: Page) =>
  page.evaluate(() => (window as unknown as Hooks).__glpFoot.tools().offer);
const jailNow = (page: Page) =>
  page.evaluate(() => (window as unknown as Hooks).__glpCapture.state());
const go = (page: Page, x: number, z: number) =>
  page.evaluate(
    ([a, b]) => (window as unknown as Hooks).__glpFoot.teleportLocal(a ?? 0, b ?? 0),
    [x, z],
  );

test('a promise to the jailer, and away aboard your ship from the city dock', async ({ page }) => {
  test.setTimeout(180_000);
  const errors = collectErrors(page);
  await boot(page);
  await breakOutAt(page, 2);

  // In the cell that night, with nothing, the door shut and the jailer on his round.
  const start = await breakout(page);
  expect(start).toMatchObject({ inCell: true, doorOpen: false, inIrons: false });
  await expect(page.getByTestId('foot-banner')).toContainText('before dawn');
  expect((await jailNow(page))?.breakout).toEqual({ attempts: 1, active: true });
  expect(await offer(page)).toBe('Bang on the bars');

  // He comes by the bars: within earshot, he'll take a promise.
  await expect
    .poll(
      async () => {
        const j = (await breakout(page))?.jailer;
        return j ? Math.hypot(j.x - 41.3, j.z - 39.6) < 0.8 : false;
      },
      { timeout: 60_000 },
    )
    .toBe(true);
  expect(await go(page, 40.4, 41.6)).toBe(true);
  await expect.poll(() => offer(page)).toBe('Promise the jailer $40 from your stash');
  await page.evaluate(() => (window as unknown as Hooks).__glpFoot.interact());
  await expect.poll(async () => (await breakout(page))?.doorOpen).toBe(true);
  expect((await breakout(page))?.jailer?.state).toBe('bribed');
  expect(await page.evaluate(() => (window as unknown as Hooks).__glpCapture.debt()?.cents)).toBe(
    4000,
  );

  // Through the town unseen (the watch looks away for the test) to the gangway.
  await page.evaluate(() => (window as unknown as Hooks).__glpFoot.suspect(false));
  const gangway = await page.evaluate(() => (window as unknown as Hooks).__glpFoot.heist().stow);
  expect(gangway).toBeDefined();
  expect(await go(page, gangway?.x ?? 0, gangway?.z ?? 0)).toBe(true);
  await expect
    .poll(() => page.evaluate(() => (window as unknown as Hooks).__glpFoot.state().prompt))
    .toBe('Go aboard and cast off');
  await page.evaluate(() => (window as unknown as Hooks).__glpFoot.interact());

  // Free, at the helm of your own ship, the jailbreak on its way to your name at dawn.
  await expect(page.locator('body')).toHaveAttribute('data-mode', 'sailing', { timeout: 20_000 });
  await expect.poll(() => jailNow(page)).toBeNull();
  const after = await page.evaluate(() => {
    const w = window as unknown as Hooks;
    return {
      breaking: w.__glpCapture.breakingOut(),
      crimes: w.__glpLaw.state().reports.crimes.map((c) => c.crime),
      reports: w.__glpLaw.state().reports.inProgress.map((r) => r.identification),
      logbook: w.__glpCapture.record().logbook.map((l) => l.text),
      mooring: w.__glpFoot.state().mooring,
    };
  });
  expect(after.breaking).toBe(false);
  expect(after.crimes).toContain('crime.jailbreak');
  expect(after.reports).toContain('person');
  expect(after.logbook.join(' ')).toContain("Broke out of Bayfield's lockup");
  expect(after.mooring).toBe('docked');
  expect(errors).toEqual([]);
});

test('a reload in the middle of an attempt loses it', async ({ page }) => {
  test.setTimeout(120_000);
  const errors = collectErrors(page);
  await boot(page);
  await breakOutAt(page, 2);
  const before = (await jailNow(page))?.sentenceWeeks ?? 0;

  await page.reload();
  await expect(page.locator('body')).toHaveAttribute('data-save', 'loaded');
  await expect(page.getByTestId('jail-screen')).toHaveAttribute('data-kind', 'cell');
  await expect(page.getByTestId('jail-break-last')).toContainText('came to nothing');
  const j = await jailNow(page);
  expect(j?.sentenceWeeks).toBe(before + 2);
  expect(j?.breakout).toEqual({ attempts: 1, active: false });
  // And another night to try again.
  await expect(page.getByTestId('jail-break')).toBeEnabled();
  expect(errors).toEqual([]);
});

test('at tier 5 it is the one chance, in irons, and dawn is the rope', async ({ page }) => {
  test.setTimeout(120_000);
  const errors = collectErrors(page);
  await boot(page);
  await page.evaluate(
    ([r]) => {
      const w = window as unknown as Hooks;
      w.__glpLaw.setTier(r as string, 5);
      w.__glpCapture.capture(r as string);
    },
    [APOSTLES],
  );
  await expect(page.getByTestId('jail-screen')).toHaveAttribute('data-kind', 'gallows');
  await expect(page.getByTestId('jail-one-chance')).toBeVisible();
  await page.getByTestId('jail-break').click();
  await expect(page.locator('body')).toHaveAttribute('data-ashore', 'foot', { timeout: 30_000 });

  const start = await breakout(page);
  expect(start).toMatchObject({ inCell: true, inIrons: true });
  expect(start?.banner?.oneChance).toBe(true);
  await expect(page.getByTestId('foot-banner')).toContainText('ONE CHANCE');
  expect(await offer(page)).toBe('Slip the irons');
  // In irons there's no moving from the spot.
  await page.keyboard.down('KeyW');
  await page.waitForTimeout(600);
  await page.keyboard.up('KeyW');
  expect((await breakout(page))?.inCell).toBe(true);

  // Dawn comes with the irons still on.
  await page.evaluate(() => (window as unknown as Hooks).__glpFoot.hour(30));
  await expect(page.getByTestId('end-screen')).toHaveAttribute('data-cause', 'executed', {
    timeout: 20_000,
  });
  expect(errors).toEqual([]);
});
