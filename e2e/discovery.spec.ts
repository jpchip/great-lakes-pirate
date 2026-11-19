import { expect, test, type Page } from '@playwright/test';

/**
 * Phase 9 piece O (plan 11 §11, §18.4): discovery and the journal. Places go on the chart
 * when the lookout sees them or the survey sheet is bought; a legend tale opens a lead with
 * its search circle; the journal's Leads, Legends, Discoveries and Curios pages show them;
 * and a curio can be set out on a hideout's shelves.
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

interface Hooks {
  __glpZones: { enter(id: string): void };
  __glpDiscovery: {
    chart(id: string, how?: string): boolean;
    curio(id: string): boolean;
    lead(id: string, text?: string): unknown;
    clue(id: string, text: string): unknown;
    state(): { found: Record<string, { how: string }>; heard: Record<string, unknown> };
    marks(): { id: string; kind: string }[];
  };
  __glpStash: { open(id?: string): void };
}

const shots = process.env['SHOTS'];
async function shot(page: Page, name: string): Promise<void> {
  if (shots) await page.screenshot({ path: `${shots}/${name}.png` });
}

test('charts places, opens a lead, fills the journal and sets out a curio', async ({ page }) => {
  const errors = collectErrors(page);
  const body = page.locator('body');
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/?renderer=null&play&debug');
  await page.waitForFunction(() => '__glpZones' in window && '__glpDiscovery' in window);
  await page.evaluate(() => (window as unknown as Hooks).__glpZones.enter('zone.apostles'));
  await expect(body).toHaveAttribute('data-zone-load', 'done');

  // Your own hideout is on the chart; the Devils Island caves aren't until they're seen.
  const st = await page.evaluate(() => (window as unknown as Hooks).__glpDiscovery.state());
  expect(st.found['site.stockton']?.how).toBe('yours');
  expect(st.found['wonder.devils_caves']).toBeUndefined();

  // Seen, read of, sounded; a legend's tale and a clue; a curio from a cache.
  await page.evaluate(() => {
    const d = (window as unknown as Hooks).__glpDiscovery;
    d.chart('wonder.devils_caves', 'spyglass');
    d.chart('poi.hermit_quarry', 'sight');
    d.chart('anchorage.julian_bay', 'visit');
    d.chart('shoal.gull_island', 'logbook');
    d.chart('poi.stockton_quarry', 'foot');
    d.lead(
      'legend.quarry_payroll',
      'When the quarry company went under in 93, the last payroll never reached the men on Hermit Island.',
    );
    d.clue(
      'legend.quarry_payroll',
      "A keeper's log: a boat put in at the quarry wharf the night the company failed.",
    );
    d.lead(
      'legend.lucerne',
      'Fishermen off Long Island say a lantern bobs where the Lucerne went down.',
    );
    d.curio('curio.brass_compass');
  });
  const marks = await page.evaluate(() => (window as unknown as Hooks).__glpDiscovery.marks());
  expect(marks.map((m) => m.id)).toEqual(
    expect.arrayContaining(['wonder.devils_caves', 'anchorage.julian_bay', 'shoal.gull_island']),
  );

  // The chart: the marks and the two lead circles.
  await page.keyboard.press('KeyM');
  await expect(body).toHaveAttribute('data-mode', 'chart');
  if (shots) {
    // Zoomed in over the islands, once the title card has gone.
    await page.waitForTimeout(4000);
    await page.mouse.move(1000, 520);
    for (let k = 0; k < 6; k++) {
      await page.mouse.wheel(0, -300);
      await page.waitForTimeout(150);
    }
    await page.waitForTimeout(500);
  }
  await shot(page, '1-chart-discoveries');

  // The journal's four new pages.
  await page.keyboard.press('KeyM');
  await expect(body).not.toHaveAttribute('data-mode', 'chart');
  await page.keyboard.press('KeyJ');
  await page.getByTestId('ledger-tab-leads').click();
  await expect(page.getByTestId('journal-lead')).toHaveCount(2);
  await expect(page.locator('[data-lead="legend.quarry_payroll"]')).toContainText("A keeper's log");
  await shot(page, '2-journal-leads');
  await page.getByTestId('ledger-tab-legends').click();
  await expect(page.getByTestId('journal-legend')).toHaveCount(2);
  await expect(page.getByTestId('journal-legend-blank')).toHaveCount(3);
  await shot(page, '3-journal-legends');
  await page.getByTestId('ledger-tab-discoveries').click();
  await expect(page.locator('[data-discovery="wonder.devils_caves"]')).toContainText(
    'Through the glass',
  );
  await expect(page.getByTestId('discoveries-anchorage')).toContainText('1 of 8 known');
  await shot(page, '4-journal-discoveries');
  await page.getByTestId('ledger-tab-curios').click();
  await expect(page.getByTestId('journal-curio')).toHaveCount(1);
  await expect(page.getByTestId('journal-curio')).toContainText('Aboard, in your sea chest');
  await shot(page, '5-journal-curios');
  await page.keyboard.press('KeyJ');

  // The stash's Curios tab: set the compass out on the shack's shelves.
  await page.evaluate(() => (window as unknown as Hooks).__glpStash.open('hideout.stockton'));
  await page.getByTestId('stash-tab-curios').click();
  await page.getByTestId('curio-show-curio.brass_compass').click();
  await expect(page.getByTestId('curio-shown')).toHaveCount(1);
  await shot(page, '6-hideout-curios');
  expect(errors).toEqual([]);
});
