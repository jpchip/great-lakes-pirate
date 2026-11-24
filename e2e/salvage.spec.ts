import { expect, test, type Page } from '@playwright/test';

/**
 * Phase 9 piece U (plan 11 §6, §18.4): salvage. The Lucerne lies off Long Island; sailing
 * over her the lead line finds her and she goes on the chart; anchored within the grapple's
 * reach F casts the grapple, and her iron ore comes up into the hold; her papers add a clue
 * to her legend's lead; the journal says what's come up from her.
 *
 * `SHOTS=dir` saves screenshots for review.
 */

function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });
  return errors;
}

interface CastOutcome {
  result: { hooked: boolean; kind?: string; good?: string; sound?: number };
}

interface Hooks {
  __glpZones: { enter(id: string): void };
  __glpSalvage: {
    sites(): { id: string; known: boolean; depthM: number; x: number; z: number }[];
    over(id: string, anchor?: boolean): boolean;
    overAt(x: number, z: number): void;
    wreckAt(x: number, z: number, name?: string): string;
    depthAt(x: number, z: number): number | undefined;
    look(): string[];
    offer(): { id: string; refusal?: string } | undefined;
    chip(): string | undefined;
    cast(chance?: number): CastOutcome | string;
    left(id: string): { good: string; qty: number }[];
    state(): { wrecks: Record<string, { casts: number; papersAt?: number }> };
  };
  __glpDiscovery: {
    state(): { found: Record<string, { how: string }> };
    leads(): { id: string; clues: { text: string }[] }[];
    lead(id: string, text?: string): unknown;
  };
  __glpWrecking: {
    marks(): string[];
    shoal(mark: string): { x: number; z: number; heading: number } | undefined;
  };
  __glpSave: unknown;
}

const shots = process.env['SHOTS'];
async function shot(page: Page, name: string): Promise<void> {
  if (shots) await page.screenshot({ path: `${shots}/${name}.png` });
}

test('finds the Lucerne by the lead line and grapples her cargo and papers', async ({ page }) => {
  const errors = collectErrors(page);
  const body = page.locator('body');
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/?renderer=null&play&debug');
  await page.waitForFunction(() => '__glpZones' in window && '__glpSalvage' in window);
  await page.evaluate(() => (window as unknown as Hooks).__glpZones.enter('zone.apostles'));
  await expect(body).toHaveAttribute('data-zone-load', 'done');

  // The record's wrecks and this run's three invented ones lie in the zone, in shallow water.
  const sites = await page.evaluate(() => (window as unknown as Hooks).__glpSalvage.sites());
  const lucerne = sites.find((s) => s.id === 'wreck.lucerne');
  expect(lucerne?.known).toBe(false);
  expect(lucerne?.depthM).toBeLessThan(10);
  expect(sites.filter((s) => s.id.startsWith('wreck.old_'))).toHaveLength(3);

  // Over her, the lead line finds her and she goes on the chart.
  const found = await page.evaluate(() => {
    const s = (window as unknown as Hooks).__glpSalvage;
    s.over('wreck.lucerne', false);
    return s.look();
  });
  expect(found).toContain('wreck.lucerne');
  const how = await page.evaluate(
    () => (window as unknown as Hooks).__glpDiscovery.state().found['wreck.lucerne']?.how,
  );
  expect(['sounding', 'sight']).toContain(how);

  // Her legend heard, then at anchor over her: F casts the grapple.
  await page.evaluate(() => {
    const w = window as unknown as Hooks;
    w.__glpDiscovery.lead(
      'legend.lucerne',
      'The Lucerne went down off Long Island with all hands.',
    );
    w.__glpSalvage.over('wreck.lucerne', true);
  });
  await expect
    .poll(() => page.evaluate(() => (window as unknown as Hooks).__glpSalvage.chip()))
    .toContain('F cast the grapple');
  await page.keyboard.press('KeyF');
  await expect(
    page.getByTestId('hud-status').filter({ hasText: 'Dragging the grapple' }),
  ).toHaveCount(1, {
    timeout: 5000,
  });
  await shot(page, '1-grapple-down');
  await expect
    .poll(
      () =>
        page.evaluate(
          () => (window as unknown as Hooks).__glpSalvage.state().wrecks['wreck.lucerne']?.casts,
        ),
      { timeout: 10000 },
    )
    .toBe(1);

  // Cast until her papers are up and some ore is aboard.
  const left0 = await page.evaluate(() =>
    (window as unknown as Hooks).__glpSalvage.left('wreck.lucerne'),
  );
  const outcomes = await page.evaluate(() => {
    const s = (window as unknown as Hooks).__glpSalvage;
    const out: unknown[] = [];
    for (let i = 0; i < 30; i++) {
      out.push(s.cast(1));
      const p = s.state().wrecks['wreck.lucerne'];
      if (p?.papersAt !== undefined && i > 3) break;
    }
    return out as (CastOutcome | string)[];
  });
  expect(outcomes.some((o) => typeof o !== 'string' && o.result.kind === 'cargo')).toBe(true);
  const left1 = await page.evaluate(() =>
    (window as unknown as Hooks).__glpSalvage.left('wreck.lucerne'),
  );
  expect(left1[0]?.qty ?? 0).toBeLessThan(left0[0]?.qty ?? 0);
  const lead = await page.evaluate(() =>
    (window as unknown as Hooks).__glpDiscovery.leads().find((l) => l.id === 'legend.lucerne'),
  );
  expect(lead?.clues.some((c) => c.text.includes('log'))).toBe(true);

  // The journal's wrecks: her line, and what's come up from her.
  await page.keyboard.press('KeyJ');
  await page.getByTestId('ledger-tab-discoveries').click();
  await expect(page.locator('[data-discovery="wreck.lucerne"]')).toContainText('Grappled');
  await shot(page, '2-journal-wreck');
  await page.keyboard.press('KeyJ');
  expect(errors).toEqual([]);
});

test("aground beside a wreck on a false light's shoal, F still casts the grapple", async ({
  page,
}) => {
  const errors = collectErrors(page);
  const body = page.locator('body');
  await page.goto('/?renderer=null&play&debug');
  await page.waitForFunction(() => '__glpWrecking' in window && '__glpSalvage' in window);
  await page.evaluate(() => (window as unknown as Hooks).__glpZones.enter('zone.apostles'));
  await expect(body).toHaveAttribute('data-zone-load', 'done');

  // A steamer broken up on a mark's shoal (as a false light leaves her), charted.
  const id = await page.evaluate(() => {
    const w = window as unknown as Hooks;
    const sh = w.__glpWrecking.shoal(w.__glpWrecking.marks()[0] ?? '');
    return sh && w.__glpSalvage.wreckAt(sh.x, sh.z, 'City of Bayfield');
  });
  expect(id).toBeDefined();

  // The schooner put on the shoal within the grapple's reach of her: hard aground, anchor up.
  const grounded = await page.evaluate((wreckId) => {
    const w = window as unknown as Hooks;
    const s = w.__glpSalvage.sites().find((x) => x.id === wreckId);
    if (!s) return false;
    for (let r = 0; r <= 30; r += 2) {
      for (let a = 0; a < 16; a++) {
        const x = s.x + Math.cos((a / 16) * Math.PI * 2) * r;
        const z = s.z + Math.sin((a / 16) * Math.PI * 2) * r;
        const d = w.__glpSalvage.depthAt(x, z);
        if (d !== undefined && d > 0.2 && d < 1.2) {
          w.__glpSalvage.overAt(x, z);
          return true;
        }
      }
    }
    return false;
  }, id);
  expect(grounded).toBe(true);
  await expect(page.getByTestId('hud-status').filter({ hasText: 'Aground' })).not.toHaveCount(0);
  await expect
    .poll(() => page.evaluate(() => (window as unknown as Hooks).__glpSalvage.chip()))
    .toContain('F cast the grapple');

  await page.keyboard.press('KeyF');
  await expect(
    page.getByTestId('hud-status').filter({ hasText: 'Dragging the grapple' }),
  ).toHaveCount(1, { timeout: 5000 });
  expect(errors).toEqual([]);
});
