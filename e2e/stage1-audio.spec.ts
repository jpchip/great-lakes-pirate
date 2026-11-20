import { expect, test, type Page } from '@playwright/test';

/**
 * Phase 9 piece J: stage 1's sounds, through the game's own paths and the audio's dataset
 * readout (`data-sandbox-cue`, `data-sandbox-beds`, `data-sandbox-tune`). At a saloon after
 * supper the room and the piano and fiddle play under the card table, a hand is cards and
 * chips, and the harbor master's tab rings his bell; on Raspberry's gallery at night the
 * lamp's clockwork turns; a rival's stinger plays from its hook; and a ship put on a
 * wrecking mark's shoal is heard going aground.
 */

interface Hooks {
  __glpPort: { open(port: string): void; close(): void };
  __glpPoker: { give(cents: number): void };
  __glpEconomy: { cargo(): unknown[] };
  __glpFoot: { hour(h: number): void; restock(): void; suspect(on: boolean | undefined): void };
  __glpStation: {
    land(id: string): Promise<string | undefined>;
    goto(part: 'tower' | 'house' | 'oil' | 'gallery'): boolean;
    here(): { id: string } | undefined;
  };
  __glpAudio: { rival(why?: string): void };
  __glpWrecking: { marks(): string[]; goto(mark: string): boolean; strand(mark: string): string };
}

type W = Window & Hooks;

function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));
  return errors;
}

test('the saloon by night: the room and the waltz, cards and chips, the harbor bell', async ({
  page,
}) => {
  test.setTimeout(150_000);
  const errors = collectErrors(page);
  const body = page.locator('body');
  await page.goto('/?renderer=null&debug&play');
  await page.waitForFunction(() => '__glpFoot' in window && '__glpPoker' in window);
  await page.evaluate(() => {
    const w = window as unknown as W;
    w.__glpFoot.hour(21);
    w.__glpPoker.give(500_000);
    w.__glpEconomy.cargo().length = 0;
    w.__glpPort.open('port.washburn');
  });
  await page.getByTestId('port-tab-saloon').click();
  await expect(body).toHaveAttribute('data-audio', 'running');
  await expect(body).toHaveAttribute('data-sandbox-tune', 'music.saloon.night');
  await expect(body).toHaveAttribute('data-sandbox-beds', /room.*tune/);

  // A hand dealt: the antes, the shuffle and the cards round.
  const cues = async (): Promise<number> => Number(await body.getAttribute('data-sandbox-cues'));
  await page.getByTestId('port-tab-cards').click();
  await expect(body).toHaveAttribute('data-sandbox-beds', /room.*tune/);
  const before = await cues();
  await page.getByTestId('card-deal').click();
  await expect.poll(cues).toBeGreaterThan(before + 10);
  await expect(body).toHaveAttribute('data-sandbox-cue', /^sfx\.poker\./);
  const table = page.getByTestId('card-table');
  for (let i = 0; i < 12; i++) {
    const phase = await table.getAttribute('data-phase');
    if (phase === 'done' || phase === 'over' || phase === 'caught') break;
    if (phase === 'draw') await page.getByTestId('card-draw').click();
    else if (await page.getByTestId('card-call').isVisible()) {
      await page.getByTestId('card-call').click();
    } else await page.getByTestId('card-check').click();
  }
  await expect(body).toHaveAttribute('data-sandbox-cue', 'sfx.poker.rake');

  // The harbor master's tab: his bell; the saloon's beds give way.
  await page.getByTestId('port-tab-harbor').click();
  await expect(body).toHaveAttribute('data-sandbox-cue', 'ui.harbor.bell');
  await expect(body).toHaveAttribute('data-sandbox-tune', '');
  expect(errors).toEqual([]);
});

test("Raspberry's lamp by night: the clockwork on the gallery, and a rival's stinger", async ({
  page,
}) => {
  test.setTimeout(150_000);
  const errors = collectErrors(page);
  const body = page.locator('body');
  await page.goto('/?renderer=null&debug&play&newrun=deckhand&zone=zone.apostles');
  await page.waitForFunction(() => '__glpStation' in window);
  await page.keyboard.press('Escape');
  await page.evaluate(() => (window as unknown as W).__glpFoot.hour(23));
  await page.waitForTimeout(500);
  // The zone's terrain may still be loading: try until the station is there to land at.
  await expect
    .poll(
      () => page.evaluate(() => (window as unknown as W).__glpStation.land('light.raspberry')),
      { timeout: 60_000 },
    )
    .toBeUndefined();
  await expect
    .poll(() => page.evaluate(() => (window as unknown as W).__glpStation.here()?.id))
    .toBe('light.raspberry');
  await expect(body).toHaveAttribute('data-audio', 'running');
  await page.evaluate(() => {
    const w = window as unknown as W;
    w.__glpFoot.suspect(false);
    w.__glpStation.goto('gallery');
  });
  await expect(body).toHaveAttribute('data-sandbox-beds', /clockwork/);

  await page.evaluate(() => (window as unknown as W).__glpAudio.rival('sighted'));
  await expect(body).toHaveAttribute('data-sandbox-cue', 'music.stinger.rival');
  expect(errors).toEqual([]);
});

test('a ship put on a shoal is heard going aground', async ({ page }) => {
  test.setTimeout(120_000);
  const errors = collectErrors(page);
  const body = page.locator('body');
  await page.goto('/?renderer=null&debug&play');
  await page.waitForFunction(() => '__glpWrecking' in window);
  await page.keyboard.press('Escape');
  await expect(body).toHaveAttribute('data-audio', 'running');
  // Laid off a mark, a ship of the traffic put on its shoal close by.
  const mark = await page.evaluate(() => {
    const w = window as unknown as W;
    const m = w.__glpWrecking.marks()[0] ?? '';
    w.__glpWrecking.goto(m);
    return m;
  });
  await page.waitForTimeout(500);
  await page.evaluate((m) => (window as unknown as W).__glpWrecking.strand(m), mark);
  await expect(body).toHaveAttribute('data-sandbox-cue', /aground/);
  expect(errors).toEqual([]);
});
