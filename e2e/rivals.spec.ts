import { expect, test, type Page } from '@playwright/test';

/**
 * Phase 9 piece E: copycat rivals. A rival takes to the lake, robs on its lane through the
 * law's pipeline, writes proposing a parley met in the saloon, sails as a ship of its own
 * on the chart, and beaten leaves a lead to its stash.
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
    contact(id: string): { kind: string; lostUntil?: number } | undefined;
  };
  __glpEvents: {
    letters(): { key: string; from: string; body: string }[];
    talk(): { lines: string[] }[];
  };
  __glpDiscovery: { leads(): { id: string; kind: string }[] };
}

test('a copycat takes to the lake, writes, sails the chart and is beaten', async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto('/?renderer=null&debug&zone=zone.apostles');
  await page.waitForFunction(() => '__glpRivals' in window);

  const id = await page.evaluate(() => (window as unknown as Hooks).__glpRivals.emerge());
  expect(id).toMatch(/^rival\.\d+$/);
  const rival = await page.evaluate(
    (rid) => (window as unknown as Hooks).__glpRivals.list().find((r) => r.id === rid),
    id,
  );
  expect(rival?.status).toBe('active');
  // The saloons talk of the newcomer.
  const talk = await page.evaluate(() =>
    (window as unknown as Hooks).__glpEvents.talk().flatMap((t) => t.lines),
  );
  expect(talk.some((l) => l.includes(rival?.nick ?? '?'))).toBe(true);

  // A parley by letter.
  expect(
    await page.evaluate(
      (rid) => (window as unknown as Hooks).__glpRivals.parley(rid as string),
      id,
    ),
  ).toBe(true);
  const letters = await page.evaluate(() => (window as unknown as Hooks).__glpEvents.letters());
  expect(letters.some((l) => l.from.includes(rival?.nick ?? '?'))).toBe(true);

  // Met at sea from the chart as a ship of her own: the chart's contact is on the water.
  const contact = await page.evaluate(
    (rid) => (window as unknown as Hooks).__glpRivals.contact(rid as string),
    id,
  );
  expect(contact?.kind).toBe('rival');
  expect(contact?.lostUntil).toBeUndefined();

  // Beaten: the papers, Fame and a lead to the stash.
  expect(
    await page.evaluate(
      (rid) => (window as unknown as Hooks).__glpRivals.defeat(rid as string),
      id,
    ),
  ).toBe(true);
  const leads = await page.evaluate(() => (window as unknown as Hooks).__glpDiscovery.leads());
  expect(leads.some((l) => l.kind === 'stash')).toBe(true);
  expect(errors).toEqual([]);
});
