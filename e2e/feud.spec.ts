import { expect, test, type Page } from '@playwright/test';

/**
 * Phase 9 piece D: the Hollister feud. Selling fish at Bayfield brings Hollister's letter
 * and its undercut on the market; more, and its buyers turn you away; robbing its tugs makes
 * it give, in the papers. On foot, the packing house's brine can be fouled at night while
 * the feud is on.
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
  __glpEconomy: {
    buy(port: string, good: string, qty: number): { ok: boolean };
    sell(port: string, good: string, qty: number): { ok: boolean };
  };
  __glpLaw: {
    commit(crime: string, region?: string, kind?: string, ident?: string, company?: string): void;
  };
  __glpFeud: {
    state(): { stage: string; sheds: number; method?: string };
    check(): unknown;
  };
  __glpFoot: {
    land(): Promise<string | undefined>;
    dock(key: string): boolean;
    hour(h: number): void;
    suspect(on: boolean | undefined): void;
    teleportLocal(x: number, z: number, headingDeg?: number): boolean;
    heist(): { doors: { id: string; x: number; z: number; locked: boolean }[] };
  };
}

/** Three sales of salt fish at Bayfield: Hollister notices. */
async function provoke(page: Page, times = 3): Promise<void> {
  await page.evaluate((n) => {
    const e = (window as unknown as Hooks).__glpEconomy;
    for (let i = 0; i < n; i++) {
      e.buy('port.bayfield', 'good.salted_fish', 2);
      e.sell('port.bayfield', 'good.salted_fish', 2);
    }
  }, times);
}

const feud = (page: Page) => page.evaluate(() => (window as unknown as Hooks).__glpFeud.state());

test("Hollister's letter, its undercut, its refusal, and how it gives", async ({ page }) => {
  const errors = collectErrors(page);
  const body = page.locator('body');
  await page.goto('/?renderer=null&debug&harbor=bayfield');
  await expect(body).toHaveAttribute('data-terrain', 'loaded');
  await page.waitForFunction(() => '__glpFeud' in window);
  await provoke(page);
  expect((await feud(page)).stage).toBe('undercut');
  // Some fish aboard to sell.
  await page.evaluate(() =>
    (window as unknown as Hooks).__glpEconomy.buy('port.bayfield', 'good.salted_fish', 4),
  );

  await page.evaluate(() => (window as unknown as Hooks).__glpPort.dock('bayfield_city'));
  await expect(page.getByTestId('port-screen')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId('feud-good.salted_fish')).toHaveText('Hollister pays you 60%');
  await page.getByTestId('port-tab-harbor').click();
  const letter = page.getByTestId('harbor-letter').filter({ hasText: 'Your fish' });
  await letter.locator('summary').click();
  await expect(letter).toContainText('sixty cents on the dollar');

  // Two more sales at his price, and his buyers turn you away.
  await page.evaluate(() => {
    const e = (window as unknown as Hooks).__glpEconomy;
    e.sell('port.bayfield', 'good.salted_fish', 2);
    e.sell('port.bayfield', 'good.salted_fish', 1);
  });
  expect((await feud(page)).stage).toBe('refused');
  await page.getByTestId('port-tab-market').click();
  await expect(page.getByTestId('feud-good.salted_fish')).toHaveText('Turned away');
  await expect(page.getByTestId('sell-good.salted_fish')).toBeDisabled();

  // Rob his tugs (named or not, he knows who), and he gives.
  await page.evaluate(() => {
    const l = (window as unknown as Hooks).__glpLaw;
    for (const c of ['crime.piracy', 'crime.piracy', 'crime.sinking']) {
      l.commit(c, 'region.chequamegon', 'none', 'ship', 'company.hollister_fish');
    }
  });
  expect(await feud(page)).toMatchObject({ stage: 'won', method: 'tugs' });
  expect(errors).toEqual([]);
});

test('fouls the brine in the packing house at night while the feud is on', async ({ page }) => {
  test.setTimeout(180_000);
  const errors = collectErrors(page);
  await page.goto('/?renderer=null&debug&play');
  await page.waitForFunction(() => '__glpFoot' in window && '__glpFeud' in window);
  await page.evaluate(() => {
    const f = (window as unknown as Hooks).__glpFoot;
    f.hour(23);
    f.dock('bayfield_fish');
  });
  expect(await page.evaluate(() => (window as unknown as Hooks).__glpFoot.land())).toBeUndefined();
  await page.evaluate(() => (window as unknown as Hooks).__glpFoot.suspect(false));
  await provoke(page);
  // In through the packing house's door (picked open), to the brine barrels.
  const door = await page.evaluate(() =>
    (window as unknown as Hooks).__glpFoot
      .heist()
      .doors.find((d) => d.id.startsWith('packing_house')),
  );
  expect(door?.locked).toBe(true);
  await page.evaluate(() => (window as unknown as Hooks).__glpFoot.teleportLocal(-36.5, 26, 90));
  const prompt = page.getByTestId('foot-tools').getByTestId('foot-prompt');
  await expect(prompt).toContainText('Foul the brine barrels');
  await page.keyboard.down('KeyF');
  await expect.poll(async () => (await feud(page)).sheds, { timeout: 15_000 }).toBeGreaterThan(0);
  await page.keyboard.up('KeyF');
  await expect(prompt).toContainText('done tonight');
  expect(errors).toEqual([]);
});
