import { expect, test, type Page } from '@playwright/test';

/**
 * Phase 9 piece H (plan 11 §18.4): a lighthouse station on foot, at Raspberry Island. By
 * day the keepers welcome you: a word, the logbook, a can from the oil house. By night
 * they're on watch and asleep: tie up the sleepers, knife the one on watch, douse the lamp,
 * and it stays dark with nobody left to light it, until you light it again yourself.
 */

interface Point {
  x: number;
  y: number;
  z: number;
}
interface Here {
  id: string;
  offer?: { label: string; ok: boolean; why?: string };
  carrying?: string;
  keepers: { id: string; name: string; state: string }[];
  record?: {
    keepers: Record<string, { diedAt?: number; downUntil?: number; bribedUntil?: number }>;
    dousedAt?: number;
    talkedAt?: number;
    oilTaken?: { count: number };
  };
}
interface Hooks {
  __glpStation: {
    list(): { id: string; dark: boolean; onDuty: number; gallery: { lamp: Point } }[];
    land(id: string): Promise<string | undefined>;
    goto(part: 'tower' | 'house' | 'oil' | 'gallery' | 'landing' | 'bluff'): boolean;
    here(): Here | undefined;
    act(): string | undefined;
    settle(): { id: string; lit: boolean; keepers: number }[];
  };
  __glpFoot: {
    hour(h: number): void;
    aboard(): void;
    restock(): void;
    suspect(on: boolean | undefined): void;
    behindGuard(id: string, distM?: number): boolean;
    interact(): void;
    tools(): { selected?: string; offer?: string };
  };
  __glpLaw: { state(): { reports: { crimes: { crime: string }[] } } };
}

function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });
  return errors;
}

const station = <T>(page: Page, fn: (s: Hooks['__glpStation']) => T): Promise<Awaited<T>> =>
  page.evaluate(`(${fn.toString()})(window.__glpStation)`) as Promise<Awaited<T>>;
const foot = <T>(page: Page, fn: (f: Hooks['__glpFoot']) => T): Promise<T> =>
  page.evaluate(`(${fn.toString()})(window.__glpFoot)`) as Promise<T>;
const raspberry = async (page: Page) =>
  (await station(page, (s) => s.list())).find((l) => l.id === 'light.raspberry');

/** Stands you at a part of the station and waits until F offers something there. */
async function goTo(page: Page, part: 'house' | 'oil' | 'gallery'): Promise<void> {
  await page.evaluate((p) => (window as unknown as Hooks).__glpStation.goto(p), part);
  await expect.poll(async () => (await station(page, (s) => s.here()))?.offer?.label).toBeDefined();
}

async function landAt(page: Page, hour: number): Promise<void> {
  await page.goto('/?renderer=null&debug&play&newrun=deckhand');
  await page.waitForFunction(() => '__glpStation' in window);
  await page.keyboard.press('Escape');
  await page.evaluate(`window.__glpFoot.hour(${hour})`);
  await page.waitForTimeout(500);
  expect(await station(page, (s) => s.land('light.raspberry'))).toBeUndefined();
  await expect.poll(async () => (await station(page, (s) => s.here()))?.id).toBe('light.raspberry');
}

test('by day the keepers welcome you: their news, the logbook and a can of kerosene', async ({
  page,
}) => {
  test.setTimeout(180_000);
  const errors = collectErrors(page);
  await landAt(page, 10);
  const here = await station(page, (s) => s.here());
  expect(here?.keepers.map((k) => k.name)).toEqual([
    'the keeper, Francis Jacker',
    'the keeper, Ole Halvorsen',
  ]);

  // F does what's to be done there; a keeper close by has a word for you first, once a day.
  const actPastTalk = async (): Promise<string | undefined> => {
    const o = await station(page, (s) => s.act());
    if (!o?.startsWith('Talk')) return o;
    expect((await station(page, (s) => s.here()))?.record?.talkedAt).toBeDefined();
    return station(page, (s) => s.act());
  };

  // The logbook's in the house.
  await goTo(page, 'house');
  expect(await actPastTalk()).toBe('Read the logbook');

  // A can from the oil house, carried in your arms down to the boat.
  await goTo(page, 'oil');
  expect(await actPastTalk()).toMatch(/^Take a can of kerosene \(\d left\)$/);
  const after = await station(page, (s) => s.here());
  expect(after?.carrying).toBe('good.kerosene');
  expect(after?.record?.oilTaken?.count).toBe(1);
  expect(errors).toEqual([]);
});

test('by night: tie the sleepers, knife the watch, douse the lamp and light it again', async ({
  page,
}) => {
  test.setTimeout(180_000);
  const errors = collectErrors(page);
  await landAt(page, 23);
  await foot(page, (f) => {
    f.restock();
    f.suspect(false);
  });
  expect((await raspberry(page))?.onDuty).toBe(2);
  expect((await raspberry(page))?.dark).toBe(false);

  // One keeper on watch up the tower; the other asleep in the house.
  const here = await station(page, (s) => s.here());
  expect(here?.keepers).toHaveLength(1);
  const watch = here?.keepers[0]?.id ?? '';

  // Tie up the sleeper.
  await goTo(page, 'house');
  expect(await station(page, (s) => s.act())).toBe('Tie up the sleeping keeper');
  expect((await raspberry(page))?.onDuty).toBe(1);

  // Knife the keeper on watch, from behind.
  expect(
    await page.evaluate((id) => (window as unknown as Hooks).__glpFoot.behindGuard(id, 1.2), watch),
  ).toBe(true);
  await page.keyboard.press('Digit3');
  await expect.poll(() => foot(page, (f) => f.tools().selected)).toBe('tool.knife');
  await foot(page, (f) => f.interact());
  await expect
    .poll(async () => (await station(page, (s) => s.here()))?.record?.keepers[watch]?.diedAt)
    .toBeDefined();
  expect((await raspberry(page))?.onDuty).toBe(0);
  const crimes = await page.evaluate(() =>
    (window as unknown as Hooks).__glpLaw.state().reports.crimes.map((c) => c.crime),
  );
  expect(crimes).toContain('crime.assault');

  // Douse the lamp: with nobody at his post it stays dark.
  await goTo(page, 'gallery');
  expect(await station(page, (s) => s.act())).toBe('Put out the lamp');
  expect((await raspberry(page))?.dark).toBe(true);
  await page.evaluate('window.__glpFoot.hour(25)');
  await page.waitForTimeout(500);
  expect(
    (await station(page, (s) => s.settle())).find((l) => l.id === 'light.raspberry')?.lit,
  ).toBe(false);

  // And light it again.
  expect(await station(page, (s) => s.act())).toBe('Light the lamp');
  expect((await raspberry(page))?.dark).toBe(false);
  expect(errors).toEqual([]);
});
