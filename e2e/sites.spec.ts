import { expect, test, type Page } from '@playwright/test';

/**
 * Phase 9 piece W (plan 11 §18 criterion 16): every background starts at its own hideout.
 * A new captain of each of the four new starts anchors at the site, goes ashore through
 * `?site=`, and opens the stash at the pre-built shack's strongbox.
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
  __glpFoot: {
    teleport(x: number, z: number, y?: number): void;
    interact(): void;
    state(): { active: boolean; inBoat: boolean; prompt: string | undefined };
    island(): {
      island: string | undefined;
      strongbox: { x: number; y: number; z: number; hideout: string } | undefined;
    };
  };
}

const STARTS = [
  { background: 'fisherman', zone: 'zone.apostles', site: 'outer' },
  { background: 'poacher', zone: 'zone.apostles', site: 'devils' },
  { background: 'saloon_keeper', zone: 'zone.twin_ports', site: 'minnesota_point' },
  { background: 'ex_navy', zone: 'zone.two_harbors', site: 'north_shore' },
] as const;

for (const s of STARTS) {
  test(`${s.background} starts at ${s.site}, and opens the stash there`, async ({ page }) => {
    test.setTimeout(180_000);
    const errors = collectErrors(page);
    await page.goto(
      `/?renderer=null&debug&play&newrun=${s.background}&zone=${s.zone}&site=${s.site}`,
    );
    await page.waitForFunction(() => '__glpFoot' in window);
    await expect(page.locator('body')).toHaveAttribute('data-zone', s.zone);
    await expect(page.locator('body')).toHaveAttribute('data-ashore', 'foot', { timeout: 90_000 });
    const box = await page.evaluate(
      () => (window as unknown as Hooks).__glpFoot.island().strongbox,
    );
    expect(box?.hideout).toBe(`hideout.${s.site}`);
    if (!box) return;
    await page.evaluate(([x, y, z]) => (window as unknown as Hooks).__glpFoot.teleport(x, z, y), [
      box.x + 1.3,
      box.y + 0.2,
      box.z,
    ] as const);
    await expect
      .poll(() => page.evaluate(() => (window as unknown as Hooks).__glpFoot.state().prompt))
      .toBe('Open the stash');
    await page.evaluate(() => (window as unknown as Hooks).__glpFoot.interact());
    await expect(page.locator('body')).toHaveAttribute('data-stash', `hideout.${s.site}`);
    expect(errors).toEqual([]);
  });
}
