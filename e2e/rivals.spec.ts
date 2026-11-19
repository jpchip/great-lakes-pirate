import { expect, test, type Page } from '@playwright/test';

/**
 * Phase 9 piece E: copycat rivals. A rival takes to the lake, robs on its lane through the
 * law's pipeline, writes proposing a parley met in the saloon, is met at sea from the chart
 * as a ship of its own, and beaten leaves a lead to its stash.
 */

function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });
  return errors;
}

interface RivalView {
  id: string;
  name: string;
  nick: string;
  status: string;
  raids: number;
  parley?: string;
}
interface Hooks {
  __glpRivals: {
    emerge(): string | undefined;
    list(): RivalView[];
    raid(id: string, method?: string): string | undefined;
    parley(id: string): boolean;
    defeat(id: string, how?: string): boolean;
  };
  __glpEvents: {
    letters(): { key: string; from: string; body: string }[];
    talk(): { lines: string[] }[];
  };
  __glpDiscovery: { leads(): { id: string; kind: string }[] };
  __glpChart: {
    plot(points: [number, number][]): string;
    meet(kind: string, forced?: boolean): string | undefined;
  };
}
const hooks = (w: Window) => w as unknown as Hooks;

test('a copycat takes to the lake, writes, is met at sea and beaten', async ({ page }) => {
  const errors = collectErrors(page);
  const body = page.locator('body');
  await page.goto('/?renderer=null&debug&zone=zone.apostles&spawn=-3350,-2450,270');
  await expect(page.getByTestId('take-to-chart')).toBeVisible();
  await page.waitForFunction(() => '__glpRivals' in window);

  const id = await page.evaluate(() => hooks(window).__glpRivals.emerge());
  expect(id).toMatch(/^rival\.\d+$/);
  const rival = await page.evaluate(
    (rid) =>
      hooks(window)
        .__glpRivals.list()
        .find((r) => r.id === rid),
    id,
  );
  expect(rival?.status).toBe('active');
  // The saloons talk of the newcomer.
  const talk = await page.evaluate(() =>
    hooks(window)
      .__glpEvents.talk()
      .flatMap((t) => t.lines),
  );
  expect(talk.some((l) => l.includes(rival?.nick ?? '?'))).toBe(true);

  // A parley by letter.
  expect(await page.evaluate((rid) => hooks(window).__glpRivals.parley(rid as string), id)).toBe(
    true,
  );
  const letters = await page.evaluate(() => hooks(window).__glpEvents.letters());
  expect(letters.some((l) => l.from.includes(rival?.nick ?? '?'))).toBe(true);

  // Met at sea from the chart: her own ship.
  await page.getByTestId('take-to-chart').click();
  await expect(body).toHaveAttribute('data-mode', 'chart');
  await page.evaluate(() =>
    hooks(window).__glpChart.plot([
      [46.97, -91.6],
      [46.85, -91.95],
    ]),
  );
  await page.keyboard.press('Enter');
  const met = await page.evaluate(() => hooks(window).__glpChart.meet('rival'));
  expect(met).toMatch(/^ship\.rival_\d$/);
  await expect(page.getByTestId('chart-encounter')).toContainText('pirate');
  await page.getByTestId('encounter-engage').click();
  await expect(body).toHaveAttribute('data-arena', 'ship');

  // Beaten: the papers, Fame and a lead to the stash.
  expect(await page.evaluate((rid) => hooks(window).__glpRivals.defeat(rid as string), id)).toBe(
    true,
  );
  const leads = await page.evaluate(() => hooks(window).__glpDiscovery.leads());
  expect(leads.some((l) => l.kind === 'stash')).toBe(true);
  expect(errors).toEqual([]);
});
