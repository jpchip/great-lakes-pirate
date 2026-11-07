import { expect, test, type Page } from '@playwright/test';

function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });
  return errors;
}

// CI runs without WebGL, so the smoke test boots with the null renderer (plan 01 §9).
test('boots with the null renderer without console errors', async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto('/?renderer=null&play');
  await expect(page.locator('body')).toHaveAttribute('data-renderer', 'null');
  await expect(page.locator('body')).toHaveAttribute('data-mode', 'sailing');
  // The Phase 1 test bay's terrain loads with or without a renderer.
  await expect(page.locator('body')).toHaveAttribute('data-terrain', 'loaded');
  expect(errors).toEqual([]);
});

// Plan 01 §11 exit criteria: a working autosave round trip through IndexedDB.
test('creates a run, autosaves it, and continues it after a reload', async ({ page }) => {
  const errors = collectErrors(page);
  const body = page.locator('body');

  await page.goto('/?renderer=null&play');
  await expect(body).toHaveAttribute('data-save', 'created');
  const runId = await body.getAttribute('data-run-id');
  expect(runId).toBeTruthy();

  // Let the clock run, then trigger the tab-hidden autosave through the save worker.
  await page.waitForTimeout(500);
  await page.evaluate(() => window.dispatchEvent(new Event('pagehide')));
  await page.reload();

  await expect(body).toHaveAttribute('data-save', 'loaded');
  await expect(body).toHaveAttribute('data-run-id', runId ?? '');
  await expect(body).toHaveAttribute('data-mode', 'sailing');
  expect(errors).toEqual([]);
});

// Plan 13 §12 Phase 1: the sailing HUD and the settings screen, which pauses the game,
// saves to the settings store and rebinds keys.
test('shows the sailing HUD and answers the helm', async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto('/?renderer=null&play');
  await expect(page.getByTestId('hud-wind')).toBeVisible();
  await expect(page.getByTestId('hud-clock')).toContainText('1900');
  // Weather v1 (plan 04 §24): the sim drives the wind, so the barometer reads.
  await expect(page.getByTestId('hud-barometer')).toContainText(/Barometer \d\d\.\d\d/);
  await expect(page.getByTestId('hud-sail')).toHaveText('Furled');
  await page.keyboard.press('KeyW');
  await expect(page.getByTestId('hud-sail')).toContainText('Reefed');
  expect(errors).toEqual([]);
});

test('settings pause the game, persist, and rebind keys', async ({ page }) => {
  const errors = collectErrors(page);
  const body = page.locator('body');
  await page.goto('/?renderer=null&play');
  await expect(page.getByTestId('hud-wind')).toBeVisible();

  await page.keyboard.press('Escape');
  await expect(page.getByTestId('settings-menu')).toBeVisible();
  await expect(body).toHaveAttribute('data-menu', 'open');
  // Paused: the clock stands still.
  const before = await page.getByTestId('hud-clock').textContent();
  await page.waitForTimeout(1500);
  expect(await page.getByTestId('hud-clock').textContent()).toBe(before);

  await page.getByTestId('setting-hud').selectOption('full');
  await page.getByTestId('tab-controls').click();
  await page.getByTestId('bind-RaiseSail').click();
  await expect(page.getByTestId('bind-RaiseSail')).toHaveText('Press a key…');
  await page.keyboard.press('KeyI');
  await expect(page.getByTestId('bind-RaiseSail')).toContainText('I');
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('settings-menu')).toBeHidden();
  await expect(body).toHaveAttribute('data-menu', 'closed');

  // W no longer raises sail; I does.
  await page.keyboard.press('KeyW');
  await page.waitForTimeout(200);
  await expect(page.getByTestId('hud-sail')).toHaveText('Furled');
  await page.keyboard.press('KeyI');
  await expect(page.getByTestId('hud-sail')).toContainText('Reefed');

  // Both survive a reload.
  await page.waitForTimeout(300);
  await page.reload();
  await expect(page.getByTestId('hud')).toHaveAttribute('data-density', 'full');
  await page.getByTestId('open-settings').click();
  await page.getByTestId('tab-controls').click();
  await expect(page.getByTestId('bind-RaiseSail')).toContainText('I');
  expect(errors).toEqual([]);
});

interface ZonesHook {
  enter(id: string): Promise<void>;
  pose(): { x: number; z: number; heading: number };
  clock(): number;
}

// A slow passage can be read through: the journal and a look at the chart let the ship
// sail on behind them, and P holds her again (the choice is the same setting both ways).
test('keeps sailing with the journal or a look at the chart open, and P holds the ship', async ({
  page,
}) => {
  const errors = collectErrors(page);
  const body = page.locator('body');
  await page.goto('/?renderer=null&play&debug');
  await page.waitForFunction(() => '__glpZones' in window);
  await page.evaluate(() =>
    (window as unknown as { __glpZones: ZonesHook }).__glpZones.enter('zone.apostles'),
  );
  await expect(body).toHaveAttribute('data-zone-load', 'done');
  await page.keyboard.press('KeyW');
  await page.keyboard.press('KeyW');
  // Give her a few seconds to gather way.
  await page.waitForTimeout(4000);
  const zones = () =>
    page.evaluate(() => {
      const z = (window as unknown as { __glpZones: ZonesHook }).__glpZones;
      return { clock: z.clock(), ...z.pose() };
    });

  // J: the journal opens with the ship sailing on; the clock runs and she moves.
  await page.keyboard.press('KeyJ');
  const journal = page.getByTestId('journal');
  await expect(journal).toHaveAttribute('data-sailing', 'on');
  const a = await zones();
  await page.waitForTimeout(1000);
  const b = await zones();
  expect(b.clock).toBeGreaterThan(a.clock);
  // How far depends on the run's wind; that she moves at all is the point.
  expect(Math.hypot(b.x - a.x, b.z - a.z)).toBeGreaterThan(0.05);

  // P holds the ship: the clock stands still with the journal still open.
  await page.keyboard.press('KeyP');
  await expect(journal).toHaveAttribute('data-sailing', 'held');
  await expect(page.getByTestId('journal-sail-on')).toHaveText('Sail on (P)');
  const c = await zones();
  await page.waitForTimeout(500);
  expect((await zones()).clock).toBe(c.clock);
  await page.keyboard.press('KeyP');
  await expect(journal).toHaveAttribute('data-sailing', 'on');
  await page.keyboard.press('Escape');
  await expect(journal).toHaveCount(0);
  await expect(page.getByTestId('settings-menu')).toHaveCount(0);

  // M far from the edge is a look at the chart: the ship sails on behind it too.
  await page.keyboard.press('KeyM');
  await expect(page.getByTestId('chart-hud')).toHaveAttribute('data-trip', 'look');
  await expect(page.getByTestId('chart-sail-on')).toContainText('Sailing on at the helm');
  const d = await zones();
  await page.waitForTimeout(800);
  const e = await zones();
  expect(e.clock).toBeGreaterThan(d.clock);
  await page.keyboard.press('KeyP');
  await expect(page.getByTestId('chart-sail-on')).toContainText('The ship is held');
  const f = await zones();
  await page.waitForTimeout(500);
  expect((await zones()).clock).toBe(f.clock);
  await page.keyboard.press('KeyM');
  await expect(body).toHaveAttribute('data-mode', 'sailing');

  // The choice is the setting, kept for next time.
  await page.keyboard.press('KeyJ');
  await expect(journal).toHaveAttribute('data-sailing', 'held');
  expect(errors).toEqual([]);
});

// Plan 15 §8: the sailing (14), world (19, with the ships' whistles), chart (7: the
// stingers and the fade to fog), harbor (5) and port (7) sounds decode up front and audio
// starts on the first key.
test('loads the sailing and world sounds and unlocks audio on the first key press', async ({
  page,
}) => {
  const errors = collectErrors(page);
  const body = page.locator('body');
  await page.goto('/?renderer=null&play');
  await expect(body).toHaveAttribute('data-mode', 'sailing');
  await expect(body).toHaveAttribute('data-audio-bank', '52');
  await page.keyboard.press('KeyW');
  await expect(body).toHaveAttribute('data-audio', 'running');
  expect(errors).toEqual([]);
});

// Plan 15 §7, Phase 2 piece H: the volume sliders are on the settings screen and persist.
test('sets a volume on the settings screen and keeps it after a reload', async ({ page }) => {
  const errors = collectErrors(page);
  const body = page.locator('body');
  await page.goto('/?renderer=null&play');
  await expect(body).toHaveAttribute('data-mode', 'sailing');
  await page.getByTestId('open-settings').click();
  await page.getByTestId('tab-sound').click();
  await page.getByTestId('volume-music').fill('0.25');
  await expect(page.getByTestId('settings-menu')).toContainText('25%');
  await page.reload();
  await expect(body).toHaveAttribute('data-mode', 'sailing');
  await page.getByTestId('open-settings').click();
  await page.getByTestId('tab-sound').click();
  await expect(page.getByTestId('volume-music')).toHaveValue('0.25');
  expect(errors).toEqual([]);
});

// Phase 3 piece A: Continue puts the ship back where the run was saved, not at the spawn.
test('continues from where the ship was saved', async ({ page }) => {
  const errors = collectErrors(page);
  const body = page.locator('body');
  await page.goto('/?renderer=null&play');
  await expect(body).toHaveAttribute('data-start', 'spawn');
  const spawn = await body.getAttribute('data-start-pose');
  // Make sail and let her move off the spawn, then save as the tab hides.
  await page.keyboard.press('KeyW');
  await page.keyboard.press('KeyW');
  await page.waitForTimeout(3000);
  await page.evaluate(() => window.dispatchEvent(new Event('pagehide')));
  await expect(body).toHaveAttribute('data-saved-pose', /.+/);
  const saved = await body.getAttribute('data-saved-pose');
  expect(saved).not.toBe(spawn);

  await page.reload();
  await expect(body).toHaveAttribute('data-save', 'loaded');
  await expect(body).toHaveAttribute('data-start', 'saved');
  await expect(body).toHaveAttribute('data-start-pose', saved ?? '');
  expect(errors).toEqual([]);
});

// Phase 3 piece A: a zone loads by id behind the fade to fog, at an entry point, and the
// run saves on arrival so a reload comes back there.
test('enters a zone by id at an entry point and saves on arrival', async ({ page }) => {
  const errors = collectErrors(page);
  const body = page.locator('body');
  await page.goto('/?renderer=null&debug&play');
  await expect(body).toHaveAttribute('data-mode', 'sailing');
  await page.evaluate(() =>
    (
      window as unknown as { __glpZones: { enter(id: string, entry: string): Promise<void> } }
    ).__glpZones.enter('zone.apostles', 'north'),
  );
  await expect(body).toHaveAttribute('data-zone-load', 'done');
  await expect(body).toHaveAttribute('data-zone', 'zone.apostles');
  await expect(body).toHaveAttribute('data-terrain', 'loaded');
  await expect(page.getByTestId('loading-screen')).toHaveAttribute('aria-hidden', 'true');
  // The north entry, heading south (data/zones.json).
  await expect(body).toHaveAttribute('data-saved-pose', /^-1000\.\d\d,-3500\.\d\d,3\.14\d\d$/);

  await page.reload();
  await expect(body).toHaveAttribute('data-start', 'saved');
  await expect(body).toHaveAttribute('data-start-pose', /^-1000\.\d\d,-3500\.\d\d,3\.14\d\d$/);
  expect(errors).toEqual([]);
});

interface EconomyHook {
  sell(port: string, good: string, qty: number): { ok: boolean };
  buy(port: string, good: string, qty: number): { ok: boolean };
  purse(): number;
  cargo(): { good: string; qty: number }[];
  load(): number;
}

// Phase 4 piece A: a new run is a Deckhand with $150 and rope and canvas; trading moves
// the purse, the hold and the ship's load, and all of it survives a reload (save v5).
test('trades at a market and keeps the purse and hold through a reload', async ({ page }) => {
  const errors = collectErrors(page);
  const body = page.locator('body');
  await page.goto('/?renderer=null&debug&play');
  await expect(body).toHaveAttribute('data-save', 'created');
  // The last dev hook goes in right before the autosave listeners: boot is done.
  await page.waitForFunction(() => '__glpChart' in window);
  const run = (): Promise<{
    purse: number;
    cargo: { good: string; qty: number }[];
    load: number;
  }> =>
    page.evaluate(() => {
      const e = (window as unknown as { __glpEconomy: EconomyHook }).__glpEconomy;
      return { purse: e.purse(), cargo: e.cargo(), load: e.load() };
    });
  expect(await run()).toMatchObject({
    purse: 15_000,
    cargo: [{ good: 'good.rope_canvas', qty: 5 }],
  });
  const sold = await page.evaluate(() => {
    const e = (window as unknown as { __glpEconomy: EconomyHook }).__glpEconomy;
    return (
      e.sell('port.bayfield', 'good.rope_canvas', 5).ok &&
      e.buy('port.bayfield', 'good.lumber', 10).ok
    );
  });
  expect(sold).toBe(true);
  const after = await run();
  expect(after.cargo).toEqual([{ good: 'good.lumber', qty: 10, paidCents: expect.any(Number) }]);
  expect(after.load).toBeCloseTo(0.35);

  await page.evaluate(() => {
    delete document.body.dataset['savedMode'];
    window.dispatchEvent(new Event('pagehide'));
  });
  await expect(body).toHaveAttribute('data-saved-mode', /.+/);
  await page.reload();
  await expect(body).toHaveAttribute('data-save', 'loaded');
  await page.waitForFunction(() => '__glpChart' in window);
  expect(await run()).toEqual(after);
  expect(errors).toEqual([]);
});

interface ChartHook {
  plot(points: [number, number][]): string;
  secondsPerHour(s: number): void;
  setPursued(on: boolean): void;
  meet(kind: string, forced?: boolean): string | undefined;
  travel: { session: { position: { x: number; y: number } } };
}

interface ArenaHook {
  place(x: number, z: number): void;
  state(): { ships: { x: number; z: number }[] } | undefined;
}

/**
 * Answers whatever the lookouts call until `done` holds: avoid where offered, else engage.
 * A meeting that puts the ship in an arena is left off the edge, and the voyage goes on.
 */
async function sailThrough(page: Page, done: () => Promise<boolean>): Promise<void> {
  const body = page.locator('body');
  for (let i = 0; i < 240 && !(await done()); i++) {
    if ((await body.getAttribute('data-arena')) !== null) {
      await page.evaluate(() =>
        (
          window as unknown as { __glpArena: { place(x: number, z: number): void } }
        ).__glpArena.place(0, -1600),
      );
      await page.waitForTimeout(250);
      continue;
    }
    for (const id of ['encounter-avoid', 'encounter-engage', 'chart-notice-ok']) {
      const button = page.getByTestId(id);
      if (await button.isVisible()) {
        await button.click({ timeout: 2000 }).catch(() => undefined);
        break;
      }
    }
    await page.waitForTimeout(250);
  }
}

// Phase 3 piece D: take to the chart at the Apostles' soft edge, plot a course to the Twin
// Ports, save and reload mid-voyage, and arrive in the Twin Ports at its entry.
test('sails from the Apostles to the Twin Ports on the chart, through a reload', async ({
  page,
}) => {
  const errors = collectErrors(page);
  const body = page.locator('body');
  // Out in the west edge's fog, heading west.
  await page.goto('/?renderer=null&debug&zone=zone.apostles&spawn=-3350,-2450,270');
  await expect(body).toHaveAttribute('data-mode', 'sailing');
  await expect(page.getByTestId('take-to-chart')).toBeVisible();
  await page.keyboard.press('KeyM');
  await expect(body).toHaveAttribute('data-mode', 'chart');
  await expect(page.getByTestId('chart-hud')).toHaveAttribute('data-trip', 'sea');
  // M straight back puts her where she was.
  await page.keyboard.press('KeyM');
  await expect(body).toHaveAttribute('data-mode', 'sailing');
  await page.getByTestId('take-to-chart').click();
  await expect(body).toHaveAttribute('data-mode', 'chart');

  expect(
    await page.evaluate(() =>
      (window as unknown as { __glpChart: ChartHook }).__glpChart.plot([
        [46.97, -91.6],
        [46.85, -91.95],
      ]),
    ),
  ).toBe('ok');
  await expect(page.getByTestId('chart-status')).toContainText('to Twin Ports');
  await expect(page.getByTestId('chart-eta')).toContainText('ETA');
  // The weather card (piece E): the glass, the outlook, and a forecast to switch to and back.
  await expect(page.getByTestId('chart-glass')).toContainText(/^Glass \d\d\.\d\d /);
  await expect(page.getByTestId('chart-outlook')).toContainText('Outlook to');
  await page.getByTestId('chart-forecast-12').click();
  await expect(page.getByTestId('chart-forecast-note')).toContainText('expected at');
  await page.getByTestId('chart-forecast-0').click();
  await expect(page.getByTestId('chart-forecast-note')).toHaveCount(0);
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('chart-status')).toContainText('Under way');

  // Saved on the chart with the voyage; a reload comes back under way.
  await page.evaluate(() => window.dispatchEvent(new Event('pagehide')));
  await expect(body).toHaveAttribute('data-saved-mode', 'chart');
  await page.goto('/?renderer=null&debug&play');
  await expect(body).toHaveAttribute('data-start', 'chart');
  await expect(body).toHaveAttribute('data-mode', 'chart');
  await expect(page.getByTestId('chart-status')).toContainText('Under way');

  await page.evaluate(() =>
    (window as unknown as { __glpChart: ChartHook }).__glpChart.secondsPerHour(0.3),
  );
  const arrived = async (): Promise<boolean> =>
    (await body.getAttribute('data-zone')) === 'zone.twin_ports' &&
    (await body.getAttribute('data-zone-load')) === 'done';
  await sailThrough(page, arrived);
  await expect(body).toHaveAttribute('data-zone', 'zone.twin_ports');
  await expect(body).toHaveAttribute('data-mode', 'sailing');
  await expect(body).toHaveAttribute('data-saved-mode', 'zone');
  // The Twin Ports' east entry (data/zones.json), just off Minnesota Point, heading for the canal.
  await expect(body).toHaveAttribute('data-saved-pose', /^400\.\d\d,250\.\d\d,5\.23\d\d$/);

  // The Twin Ports offer the chart from just outside the harbor, so it's on offer here.
  await expect(page.getByTestId('take-to-chart')).toBeVisible();
  await page.keyboard.press('KeyM');
  await expect(page.getByTestId('chart-hud')).toHaveAttribute('data-trip', 'sea');
  await page.keyboard.press('KeyM');
  await expect(body).toHaveAttribute('data-mode', 'sailing');

  // M in the Apostles' open water, far from the edge, is a look: no setting out from here.
  await page.evaluate(() =>
    (window as unknown as { __glpZones: { enter(id: string): Promise<void> } }).__glpZones.enter(
      'zone.apostles',
    ),
  );
  await expect(body).toHaveAttribute('data-zone', 'zone.apostles');
  await expect(body).toHaveAttribute('data-zone-load', 'done');
  await page.keyboard.press('KeyM');
  await expect(page.getByTestId('chart-hud')).toHaveAttribute('data-trip', 'look');
  await expect(page.getByTestId('chart-sail')).toBeDisabled();
  await page.keyboard.press('KeyM');
  await expect(body).toHaveAttribute('data-mode', 'sailing');

  // Pursued: the chart is locked.
  await page.evaluate(() =>
    (window as unknown as { __glpChart: ChartHook }).__glpChart.setPursued(true),
  );
  await expect(page.getByTestId('chart-locked')).toBeVisible();
  await page.keyboard.press('KeyM');
  await page.waitForTimeout(300);
  await expect(body).toHaveAttribute('data-mode', 'sailing');
  expect(errors).toEqual([]);
});

// Phase 3 piece G: `?encounter=` drops into an open-water arena with the ship met, and
// sailing off its edge ends it, back in the zone it was entered from. An arena entered
// from the chart returns there instead. Nothing in the arena overwrites the run's saved place.
test('drops into an arena and leaves it off the edge', async ({ page }) => {
  const errors = collectErrors(page);
  const body = page.locator('body');
  await page.goto('/?renderer=null&debug&encounter=convoy');
  await expect(body).toHaveAttribute('data-arena', 'ship');
  await expect(body).toHaveAttribute('data-arena-ships', '3');
  await expect(body).toHaveAttribute('data-zone', 'arena');
  const saved = await body.getAttribute('data-saved-pose');
  await page.evaluate(() => window.dispatchEvent(new Event('pagehide')));
  await page.waitForTimeout(300);
  expect(await body.getAttribute('data-saved-pose')).toBe(saved);

  await page.evaluate(() =>
    (window as unknown as { __glpArena: { place(x: number, z: number): void } }).__glpArena.place(
      0,
      -1600,
    ),
  );
  await expect(body).toHaveAttribute('data-arena-result', 'left');
  await expect(body).toHaveAttribute('data-zone', 'zone.apostles');
  await expect(body).not.toHaveAttribute('data-arena', /.+/);
  expect(errors).toEqual([]);
});

// Phase 3 piece G with D: Engage on the chart drops into an arena; sailing off its edge
// resumes the voyage. A hunting cutter that catches you ends the voyage instead.
test('meets a ship from the chart in an arena and sails on', async ({ page }) => {
  const errors = collectErrors(page);
  const body = page.locator('body');
  await page.goto('/?renderer=null&debug&zone=zone.apostles&spawn=-3350,-2450,270');
  await expect(page.getByTestId('take-to-chart')).toBeVisible();
  await page.getByTestId('take-to-chart').click();
  await expect(body).toHaveAttribute('data-mode', 'chart');
  await page.evaluate(() =>
    (window as unknown as { __glpChart: ChartHook }).__glpChart.plot([
      [46.97, -91.6],
      [46.85, -91.95],
    ]),
  );
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('chart-status')).toContainText('Under way');

  // Close with a freighter.
  const met = await page.evaluate(() =>
    (window as unknown as { __glpChart: ChartHook }).__glpChart.meet('freighter'),
  );
  expect(met).toBeTruthy();
  await page.getByTestId('encounter-engage').click();
  await expect(body).toHaveAttribute('data-arena', 'ship');
  await expect(body).toHaveAttribute('data-mode', 'sailing');
  await page.evaluate(() =>
    (window as unknown as { __glpArena: ArenaHook }).__glpArena.place(0, -1600),
  );
  await expect(body).toHaveAttribute('data-arena-result', 'left');
  await expect(body).toHaveAttribute('data-mode', 'chart');
  await expect(body).toHaveAttribute('data-zone', 'zone.apostles');
  await expect(page.getByTestId('chart-status')).toContainText('Under way');
  const metAt = await page.evaluate(() => ({
    ...(window as unknown as { __glpChart: ChartHook }).__glpChart.travel.session.position,
  }));

  // M leaves an arena too, and the voyage carries on from where she was met: the same
  // press doesn't also open the chart as a look from the zone she set out from.
  await page.evaluate(() =>
    (window as unknown as { __glpChart: ChartHook }).__glpChart.meet('freighter'),
  );
  await page.getByTestId('encounter-engage').click();
  await expect(body).toHaveAttribute('data-arena', 'ship');
  await expect(body).toHaveAttribute('data-mode', 'sailing');
  await page.keyboard.press('KeyM');
  await expect(body).toHaveAttribute('data-arena-result', 'left');
  await expect(body).toHaveAttribute('data-mode', 'chart');
  await expect(body).toHaveAttribute('data-zone-load', 'done');
  await expect(page.getByTestId('chart-hud')).toHaveAttribute('data-trip', 'sea');
  await expect(page.getByTestId('chart-status')).toContainText('Under way');
  const resumedAt = await page.evaluate(
    () => (window as unknown as { __glpChart: ChartHook }).__glpChart.travel.session.position,
  );
  expect(Math.hypot(resumedAt.x - metAt.x, resumedAt.y - metAt.y)).toBeLessThan(2000);

  // The cutter closes and won't be avoided; caught, the voyage ends.
  await page.evaluate(() =>
    (window as unknown as { __glpChart: ChartHook }).__glpChart.meet('cutter', true),
  );
  await page.getByTestId('encounter-engage').click();
  await expect(body).toHaveAttribute('data-arena', 'cutter');
  await expect(page.getByTestId('chart-locked')).toBeVisible();
  await page.evaluate(() => {
    const a = (window as unknown as { __glpArena: ArenaHook }).__glpArena;
    const s = a.state()?.ships[0];
    if (s) a.place(s.x, s.z + 10);
  });
  await expect(body).toHaveAttribute('data-arena-result', 'caught');
  await expect(body).toHaveAttribute('data-mode', 'chart');
  await expect(page.getByTestId('chart-notice')).toContainText('Boarded');
  await expect(page.getByTestId('chart-status')).not.toContainText('Under way');
  expect(errors).toEqual([]);
});

// Phase 3 piece J, part 2: the chart's theme starts once the chart has been open a moment,
// the lookout's reports bring their stingers, and the fade to fog sounds under each load.
test('plays the chart theme, the encounter stingers and the fade to fog', async ({ page }) => {
  const errors = collectErrors(page);
  const body = page.locator('body');
  await page.goto('/?renderer=null&debug&zone=zone.apostles&spawn=-3350,-2450,270');
  await expect(page.getByTestId('take-to-chart')).toBeVisible();
  await page.keyboard.press('KeyW');
  await expect(body).toHaveAttribute('data-audio', 'running');
  await expect(body).toHaveAttribute('data-chart-music', 'off');
  await page.getByTestId('take-to-chart').click();
  await expect(body).toHaveAttribute('data-mode', 'chart');
  await expect(body).toHaveAttribute('data-chart-music', 'playing');
  await page.evaluate(() =>
    (window as unknown as { __glpChart: ChartHook }).__glpChart.plot([
      [46.97, -91.6],
      [46.85, -91.95],
    ]),
  );
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('chart-status')).toContainText('Under way');

  await page.evaluate(() =>
    (window as unknown as { __glpChart: ChartHook }).__glpChart.meet('freighter'),
  );
  await expect(body).toHaveAttribute('data-stinger', 'sail');
  await page.getByTestId('encounter-engage').click();
  await expect(body).toHaveAttribute('data-arena', 'ship');
  await expect(body).toHaveAttribute('data-audio-fades', '1');
  await expect(body).toHaveAttribute('data-chart-music', 'off');
  await page.evaluate(() =>
    (window as unknown as { __glpArena: ArenaHook }).__glpArena.place(0, -1600),
  );
  await expect(body).toHaveAttribute('data-mode', 'chart');
  await expect(body).toHaveAttribute('data-audio-fades', '2');
  await expect(body).toHaveAttribute('data-chart-music', 'playing');

  await page.evaluate(() =>
    (window as unknown as { __glpChart: ChartHook }).__glpChart.meet('cutter', true),
  );
  await expect(body).toHaveAttribute('data-stinger', 'hunted');
  expect(errors).toEqual([]);
});

interface PortHook {
  dock(key: string): boolean;
  docked(): string | undefined;
  knowledge(): Record<string, Record<string, { sellCents: number; heard?: string }>>;
  stores(): Record<string, number>;
  open(port: string): void;
}

// Phase 4 piece B: docking at a port's pier opens its screen; selling and buying there move
// the purse and the hold, the chandlery fills the lockers, the ledger keeps the prices, and
// Esc, P, J and F work the screens and the berth.
test('docks at Bayfield, trades on the port screen, and keeps the ledger', async ({ page }) => {
  const errors = collectErrors(page);
  const body = page.locator('body');
  await page.goto('/?renderer=null&debug&harbor=bayfield');
  await expect(body).toHaveAttribute('data-terrain', 'loaded');
  await page.waitForFunction(() => '__glpChart' in window);
  const docked = await page.evaluate(() =>
    (window as unknown as { __glpPort: PortHook }).__glpPort.dock('bayfield_city'),
  );
  expect(docked).toBe(true);

  const screen = page.getByTestId('port-screen');
  await expect(screen).toBeVisible({ timeout: 15_000 });
  await expect(screen).toHaveAttribute('data-port', 'port.bayfield');
  await expect(body).toHaveAttribute('data-port', 'port.bayfield');
  await expect(page.getByTestId('port-purse')).toHaveText('$150.00');

  // The market marks what Bayfield makes and wants, with a line of hints above the table.
  await expect(page.getByTestId('market-hints')).toContainText('salted fish');
  await expect(
    page.getByTestId('market-row-good.salted_fish').getByTestId('role-export'),
  ).toHaveAttribute('aria-label', 'made here');
  await expect(
    page.getByTestId('market-row-good.kerosene').getByTestId('role-import'),
  ).toHaveAttribute('aria-label', 'wanted here');

  // Shift-click sells all the rope and canvas.
  await page.getByTestId('sell-good.rope_canvas').click({ modifiers: ['Shift'] });
  await expect(page.getByTestId('hold-row')).toHaveCount(0);
  const purse = Number((await page.getByTestId('port-purse').innerText()).replace(/[$,]/g, ''));
  expect(purse).toBeGreaterThan(150);

  // Pick lumber, slide to 4 CU, buy.
  await page.getByTestId('buy-good.lumber').click();
  await page.getByTestId('trade-qty').fill('4');
  await expect(page.getByTestId('trade-qty-text')).toHaveText('4 CU');
  await page.getByTestId('trade-confirm').click();
  await expect(page.getByTestId('hold-row')).toHaveCount(1);
  await expect(page.getByTestId('port-capacity')).toContainText('4 / 20 CU');
  // What the lumber cost shows beside it in the hold and on the market row.
  await expect(page.getByTestId('hold-paid')).toContainText('paid $');

  await page.getByTestId('port-tab-chandlery').click();
  await page.getByTestId('store-store.lamp_oil').click();
  const stores = await page.evaluate(() =>
    (window as unknown as { __glpPort: PortHook }).__glpPort.stores(),
  );
  expect(stores).toEqual({ 'store.lamp_oil': 1 });

  // A round in the saloon brings a rumor (piece K), which the ledger keeps.
  await page.getByTestId('port-tab-saloon').click();
  await page.getByTestId('saloon-round').click();
  await expect(page.getByTestId('saloon').getByTestId('rumor')).toHaveCount(1);

  // J turns to the ledger, which has Bayfield's prices.
  await page.keyboard.press('KeyJ');
  await expect(page.getByTestId('ledger')).toBeVisible();
  await expect(page.getByTestId('ledger-port')).toContainText('Bayfield');
  await page.getByTestId('ledger-tab-rumors').click();
  await expect(page.getByTestId('ledger-rumors').getByTestId('rumor')).toHaveCount(1);

  // Esc goes back aboard, still docked; the HUD offers the port again, and P reopens it.
  await page.keyboard.press('Escape');
  await expect(screen).toHaveCount(0);
  await expect(page.getByTestId('settings-menu')).toHaveCount(0);
  await expect(page.getByTestId('hud-port')).toHaveText(/Bayfield/);
  await page.keyboard.press('KeyP');
  await expect(screen).toBeVisible();

  // F on the screen casts off.
  await page.keyboard.press('KeyF');
  await expect(screen).toHaveCount(0);
  await expect(page.getByTestId('hud-status').filter({ hasText: 'Casting off' })).toHaveCount(1);
  await expect(page.getByTestId('hud-port')).toHaveCount(0);

  // At the helm, J opens the ledger on its own.
  await page.keyboard.press('KeyJ');
  await expect(page.getByTestId('journal')).toBeVisible();
  // At sea it opens on the hold: the lumber, with what it cost.
  await expect(page.getByTestId('ledger-hold')).toContainText('Hold 4 / 20 CU');
  await expect(page.getByTestId('ledger-hold-row')).toHaveCount(1);
  await expect(page.getByTestId('ledger-hold-row')).toContainText('Lumber');
  await expect(page.getByTestId('ledger-hold-row')).toContainText('$');
  await page.keyboard.press('KeyJ');
  await expect(page.getByTestId('journal')).toHaveCount(0);

  const known = await page.evaluate(() =>
    (window as unknown as { __glpPort: PortHook }).__glpPort.knowledge(),
  );
  // Only Bayfield's prices were seen first-hand; the saloon's talk may add a heard price elsewhere.
  const seen = Object.keys(known).filter((port) =>
    Object.values(known[port] ?? {}).some((price) => !price.heard),
  );
  expect(seen).toEqual(['port.bayfield']);
  expect(Object.values(known['port.bayfield'] ?? {}).every((price) => !price.heard)).toBe(true);
  expect(errors).toEqual([]);
});

// Phase 4 piece J: Bayfield is at work (its mill, cooperage and depot), docking opens the
// port screen to the rustle of paper, a sale counts coins, and a fog signal is captioned
// with an arrow toward the light.
test('hears the harbor at work, the coins at the market, and captions a fog signal', async ({
  page,
}) => {
  const errors = collectErrors(page);
  const body = page.locator('body');
  await page.goto('/?renderer=null&debug&harbor=bayfield');
  await expect(body).toHaveAttribute('data-terrain', 'loaded');
  await page.keyboard.press('KeyW');
  await expect(body).toHaveAttribute('data-audio', 'running');
  await expect
    .poll(async () => Number(await body.getAttribute('data-harbor-sites')))
    .toBeGreaterThanOrEqual(3);

  await page.waitForFunction(() => '__glpChart' in window);
  await page.evaluate(() =>
    (window as unknown as { __glpPort: PortHook }).__glpPort.dock('bayfield_city'),
  );
  const screen = page.getByTestId('port-screen');
  await expect(screen).toBeVisible({ timeout: 15_000 });
  await expect(body).toHaveAttribute('data-trade-cue', 'open');
  await page.getByTestId('sell-good.rope_canvas').click({ modifiers: ['Shift'] });
  await expect(body).toHaveAttribute('data-trade-cue', /^(coins x\d|pile)$/);
  await page.keyboard.press('Escape');
  await expect(body).toHaveAttribute('data-trade-cue', 'close');

  // No caption on a clear day until a signal sounds; then one with an arrow.
  await expect(page.getByTestId('caption')).toHaveCount(0);
  await page.evaluate(() =>
    (window as unknown as { __glpAudio: { fogSignal(): void } }).__glpAudio.fogSignal(),
  );
  const caption = page.getByTestId('caption').first();
  await expect(caption).toContainText(/Light: fog (bell|whistle)/, { timeout: 15_000 });
  await expect(caption.locator('.hud-caption-arrow')).toHaveText(/[↑↗→↘↓↙←↖]/);
  expect(errors).toEqual([]);
});

interface ContrabandHook {
  present(): boolean;
  alongside(): boolean;
  makeHot(good: string, qty?: number): number;
  learn(): void;
  known(): boolean;
}

// Phase 4 piece H: after dark the island smuggler lies in Oak Island's lee. Alongside her,
// F opens her screen: buy untaxed whiskey, fence a hot lot, sheer off. Then try the whiskey
// on a Bayfield merchant from the port screen's hold.
test('meets the island smuggler after dark and tries her whiskey in Bayfield', async ({ page }) => {
  const errors = collectErrors(page);
  const body = page.locator('body');
  await page.goto('/?renderer=null&play&debug&hour=23');
  await expect(body).toHaveAttribute('data-terrain', 'loaded');
  await page.waitForFunction(() => '__glpContraband' in window);
  await page.waitForFunction(() =>
    (window as unknown as { __glpContraband: ContrabandHook }).__glpContraband.present(),
  );
  await page.evaluate(() => {
    const h = (window as unknown as { __glpContraband: ContrabandHook }).__glpContraband;
    h.makeHot('good.rope_canvas', 5);
    h.alongside();
  });
  await expect(page.getByTestId('hud-status').filter({ hasText: 'F trade with' })).toHaveCount(1, {
    timeout: 10_000,
  });
  await page.keyboard.press('KeyF');
  const screen = page.getByTestId('smuggler-screen');
  await expect(screen).toBeVisible({ timeout: 10_000 });
  await expect(body).toHaveAttribute('data-smuggler', 'open');

  // The hot rope and canvas fetch 40% of their value.
  await expect(page.getByTestId('smuggler-lot').first()).toContainText('40% of its value');
  await page.getByTestId('smuggler-sell-good.rope_canvas').click({ modifiers: ['Shift'] });
  await expect(page.getByTestId('smuggler-message')).toContainText('swung across');
  // Shift-click buys all the whiskey the purse and hold allow.
  await page.getByTestId('smuggler-buy-good.untaxed_whiskey').click({ modifiers: ['Shift'] });
  await expect(page.getByTestId('smuggler-message')).toContainText('untaxed whiskey handed down');
  await expect(page.getByTestId('smuggler-lot').filter({ hasText: 'barrels enough' })).toHaveCount(
    1,
  );
  await page.keyboard.press('Escape');
  await expect(screen).toHaveCount(0);

  // On a Bayfield merchant: sold on the quiet, refused or confiscated, but always an answer.
  await page.evaluate(() =>
    (window as unknown as { __glpPort: PortHook }).__glpPort.open('port.bayfield'),
  );
  await expect(page.getByTestId('port-screen')).toBeVisible();
  await page.getByTestId('offer-good.untaxed_whiskey').click();
  await expect(page.getByTestId('port-message')).toContainText(
    /Sold on the quiet|won't have|revenue man/,
  );
  expect(errors).toEqual([]);
});

interface ContractsHook {
  state(): { active: { id: string; to: string }[]; tally: Record<string, number> };
  standing(): Record<string, number>;
}

// Phase 4 piece F: the freight agent's board at Bayfield, taking a contract onto the hold,
// and delivering it at its destination for the pay, the deposit back and Standing.
test('takes a freight contract at Bayfield and delivers it', async ({ page }) => {
  const errors = collectErrors(page);
  const body = page.locator('body');
  await page.goto('/?renderer=null&debug&harbor=bayfield');
  await expect(body).toHaveAttribute('data-terrain', 'loaded');
  await page.waitForFunction(() => '__glpPort' in window && '__glpContracts' in window);
  await page.evaluate(() =>
    (window as unknown as { __glpPort: PortHook }).__glpPort.dock('bayfield_city'),
  );
  const screen = page.getByTestId('port-screen');
  await expect(screen).toBeVisible({ timeout: 15_000 });

  await page.getByTestId('port-tab-freight').click();
  await expect(page.getByTestId('freight')).toBeVisible();
  const take = page.locator('button[data-testid^="accept-"]').first();
  await expect(take).toBeVisible();
  await take.click();
  await expect(page.locator('li[data-testid^="held-port"]')).toHaveCount(1);
  await expect(page.getByTestId('hold-row').filter({ hasText: 'contract' })).toHaveCount(1);

  const to = await page.evaluate(
    () =>
      (window as unknown as { __glpContracts: ContractsHook }).__glpContracts.state().active[0]?.to,
  );
  expect(to).toBeTruthy();
  await page.evaluate((port) => {
    const hook = (window as unknown as { __glpPort: { close(): void; open(p: string): void } })
      .__glpPort;
    hook.close();
    hook.open(port as string);
  }, to);
  await expect(page.getByTestId('port-notices')).toContainText('Delivered');
  const tally = await page.evaluate(
    () => (window as unknown as { __glpContracts: ContractsHook }).__glpContracts.state().tally,
  );
  expect(tally['delivered']).toBe(1);
  const standing = await page.evaluate(() =>
    (window as unknown as { __glpContracts: ContractsHook }).__glpContracts.standing(),
  );
  expect(standing['port.bayfield']).toBeGreaterThan(0);
  expect(errors).toEqual([]);
});

interface StashHook {
  hideouts(): Record<string, { storage: { goods: { good: string; qty: number }[]; cash: number } }>;
  lie(until: 'dawn' | 'dusk' | 'wind'): string | undefined;
}

// Waiting in port: the port screen's footer runs the clock on alongside, the market moves
// with it, and back aboard the HUD offers the same wait (Z) while moored.
test('waits alongside at Bayfield from the port screen and the HUD', async ({ page }) => {
  const errors = collectErrors(page);
  const body = page.locator('body');
  await page.goto('/?renderer=null&debug&harbor=bayfield');
  await expect(body).toHaveAttribute('data-terrain', 'loaded');
  await page.waitForFunction(() => '__glpChart' in window);
  const docked = await page.evaluate(() =>
    (window as unknown as { __glpPort: PortHook }).__glpPort.dock('bayfield_city'),
  );
  expect(docked).toBe(true);
  const screen = page.getByTestId('port-screen');
  await expect(screen).toBeVisible({ timeout: 15_000 });

  await expect(screen.getByTestId('lie-watch')).toBeEnabled();
  await screen.getByTestId('lie-watch').click();
  await expect(page.getByTestId('port-message')).toHaveText('You lay alongside a watch (4 h).');
  await screen.getByTestId('lie-hour').click();
  await expect(page.getByTestId('port-message')).toHaveText('You lay alongside an hour.');

  await page.keyboard.press('Escape');
  await expect(screen).toHaveCount(0);
  await expect(page.getByTestId('hud-wait')).toBeVisible();
  await page.getByTestId('hud-wait').click();
  const dialog = page.getByTestId('lie-dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('heading')).toHaveText('Lie alongside');
  await dialog.getByTestId('lie-dawn').click();
  await expect(dialog).toHaveCount(0);
  await expect(
    page.getByTestId('hud-status').filter({ hasText: /lay alongside until dawn/ }),
  ).toHaveCount(1);
  expect(errors).toEqual([]);
});

// Phase 4 piece E: come alongside the Stockton landing, stash the cargo and some cash,
// and find them still there after a reload, with nothing of it in the hold.
test('stashes cargo and cash at Stockton and keeps them through a reload', async ({ page }) => {
  const errors = collectErrors(page);
  const body = page.locator('body');
  await page.goto('/?renderer=null&debug&harbor=stockton');
  await expect(body).toHaveAttribute('data-terrain', 'loaded');
  await page.waitForFunction(() => '__glpChart' in window);
  const docked = await page.evaluate(() =>
    (window as unknown as { __glpPort: PortHook }).__glpPort.dock('stockton_landing'),
  );
  expect(docked).toBe(true);

  const screen = page.getByTestId('stash-screen');
  await expect(screen).toBeVisible({ timeout: 15_000 });
  await expect(screen).toHaveAttribute('data-hideout', 'hideout.stockton');
  await expect(page.getByTestId('port-screen')).toHaveCount(0);

  // Shift-click stashes the whole lot of rope and canvas; the hold empties.
  await page.getByTestId('stash-0').click({ modifiers: ['Shift'] });
  await expect(page.getByTestId('stash-hold-row')).toHaveCount(0);
  await expect(page.getByTestId('stash-store-row')).toHaveCount(1);
  // $100 into the strongbox.
  await page.getByTestId('stash-cash-amount').fill('100');
  await page.getByTestId('stash-cash-in').click();
  await expect(page.getByTestId('stash-strongbox')).toHaveText('$100.00');
  await expect(page.getByTestId('stash-purse')).toHaveText('$50.00');

  // Esc goes back aboard; the HUD offers the stash, and P reopens it.
  await page.keyboard.press('Escape');
  await expect(screen).toHaveCount(0);
  await expect(page.getByTestId('hud-port')).toHaveText(/Stockton Stash/);
  await page.keyboard.press('KeyP');
  await expect(screen).toBeVisible();
  // Alongside, the captain can lie until dusk; the clock runs on.
  await page.getByTestId('lie-dusk').click();
  await expect(page.getByTestId('stash-message')).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('hud-status').filter({ hasText: /lay alongside/ })).toHaveCount(1);

  await page.evaluate(() => {
    delete document.body.dataset['savedMode'];
    window.dispatchEvent(new Event('pagehide'));
  });
  await expect(body).toHaveAttribute('data-saved-mode', /.+/);
  await page.goto('/?renderer=null&debug&play');
  await expect(body).toHaveAttribute('data-save', 'loaded');
  await page.waitForFunction(() => '__glpChart' in window);
  const after = await page.evaluate(() => ({
    stash: (window as unknown as { __glpStash: StashHook }).__glpStash.hideouts(),
    cargo: (window as unknown as { __glpEconomy: EconomyHook }).__glpEconomy.cargo(),
    purse: (window as unknown as { __glpEconomy: EconomyHook }).__glpEconomy.purse(),
  }));
  expect(after.stash['hideout.stockton']?.storage).toEqual({
    goods: [{ good: 'good.rope_canvas', qty: 5 }],
    cash: 10_000,
  });
  expect(after.cargo).toEqual([]);
  expect(after.purse).toBe(5_000);
  expect(errors).toEqual([]);
});

// Phase 4 piece C: the main menu, character creation and a new captain's first morning,
// docked at the starting port with the First Week checklist; Continue brings the run back.
test('creates a captain from the main menu and starts docked at dawn', async ({ page }) => {
  const errors = collectErrors(page);
  const body = page.locator('body');
  await page.goto('/?renderer=null');
  await expect(page.getByTestId('main-menu')).toBeVisible();
  await expect(body).toHaveAttribute('data-mode', 'mainMenu');
  // A fresh browser has no run to continue.
  await expect(page.getByTestId('menu-continue')).toHaveCount(0);

  // Settings open from the menu and Esc comes back.
  await page.getByTestId('menu-settings').click();
  await expect(page.getByTestId('settings-menu')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('main-menu')).toBeVisible();

  await page.getByTestId('menu-new-run').click();
  await expect(page.getByTestId('character-creation')).toBeVisible();
  await expect(body).toHaveAttribute('data-mode', 'characterCreation');
  await page.getByTestId('create-name').fill('');
  await page.getByTestId('create-start').click();
  await expect(page.getByTestId('create-problem')).toBeVisible();
  await page.getByTestId('create-name').fill('Ida Bergquist');
  await page.getByTestId('create-ship').fill('Kittiwake');
  await page.getByTestId('portrait-woman').click();
  await page.getByTestId('background-fisherman').click();
  await expect(page.getByTestId('background-detail')).toContainText('salted fish');
  // The permadeath notice is confirmed once (plan 12 §2.1).
  await page.getByTestId('create-start').click();
  await expect(page.getByTestId('character-creation')).toBeVisible();
  await page.getByTestId('create-permadeath-ok').check();
  await page.getByTestId('create-start').click();

  // Docked at Bayfield's fish dock at dawn: the port screen opens on the first tick.
  const screen = page.getByTestId('port-screen');
  await expect(screen).toBeVisible({ timeout: 20_000 });
  await expect(screen).toHaveAttribute('data-port', 'port.bayfield');
  await expect(body).toHaveAttribute('data-save', 'created');
  await expect(page.getByTestId('port-purse')).toHaveText('$100.00');
  await page.getByTestId('sell-good.salted_fish').click({ modifiers: ['Shift'] });
  await expect(page.getByTestId('hold-row')).toHaveCount(0);

  // Back aboard: the First Week tracker has ticked the sale off.
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('first-week-count')).toHaveText('1/5');
  await expect(page.getByTestId('first-week-next')).toContainText('freight contract');
  await expect(page.getByTestId('hud-clock')).toContainText('May 7, 1900');
  // The journal has the whole list.
  await page.keyboard.press('KeyJ');
  await expect(page.getByTestId('first-week-sell')).toHaveClass(/done/);
  await page.keyboard.press('KeyJ');

  // Continue brings the captain back from the menu.
  await page.evaluate(() => window.dispatchEvent(new Event('pagehide')));
  await page.waitForTimeout(500);
  await page.reload();
  await expect(page.getByTestId('saved-run')).toContainText('Ida Bergquist');
  await expect(page.getByTestId('saved-run')).toContainText('Kittiwake');
  await page.getByTestId('menu-continue').click();
  await expect(body).toHaveAttribute('data-save', 'loaded');
  await expect(body).toHaveAttribute('data-mode', 'sailing');
  await expect(page.getByTestId('first-week-count')).toHaveText('1/5');

  // A new run over it asks first.
  await page.reload();
  await page.getByTestId('menu-new-run').click();
  await expect(page.getByTestId('menu-replace')).toContainText('Kittiwake');
  expect(errors).toEqual([]);
});

// Phase 4 criterion 1 (plan 05 §16.3): a new captain works through the whole First Week
// checklist: sell the starting cargo, deliver a contract, stash goods at Stockton, hear a
// rumor in a saloon and set out on a voyage, and the tracker ticks each one off.
test('a new captain completes the First Week', async ({ page }) => {
  const errors = collectErrors(page);
  const body = page.locator('body');
  await page.goto('/?renderer=null&debug&newrun=deckhand&seed=first-week');
  const screen = page.getByTestId('port-screen');
  await expect(screen).toBeVisible({ timeout: 20_000 });
  await expect(screen).toHaveAttribute('data-port', 'port.bayfield');
  await page.waitForFunction(() => '__glpPort' in window && '__glpContracts' in window);

  // 1. Sell the rope and canvas, and buy a little lumber for the stash.
  await page.getByTestId('sell-good.rope_canvas').click({ modifiers: ['Shift'] });
  await page.getByTestId('buy-good.lumber').click();
  await page.getByTestId('trade-qty').fill('2');
  await page.getByTestId('trade-confirm').click();
  await expect(page.getByTestId('hold-row')).toHaveCount(1);

  // 4. A round in the saloon.
  await page.getByTestId('port-tab-saloon').click();
  await page.getByTestId('saloon-round').click();
  await expect(page.getByTestId('saloon').getByTestId('rumor')).toHaveCount(1);

  // 2. Take a contract and deliver it at its port.
  await page.getByTestId('port-tab-freight').click();
  await page.locator('button[data-testid^="accept-"]').first().click();
  const to = await page.evaluate(
    () =>
      (window as unknown as { __glpContracts: ContractsHook }).__glpContracts.state().active[0]?.to,
  );
  expect(to).toBeTruthy();
  await page.evaluate((port) => {
    const hook = (window as unknown as { __glpPort: { close(): void; open(p: string): void } })
      .__glpPort;
    hook.close();
    hook.open(port as string);
  }, to);
  await expect(page.getByTestId('port-notices')).toContainText('Delivered');
  await page.keyboard.press('Escape');
  await expect(screen).toHaveCount(0);
  await expect(page.getByTestId('first-week-count')).toHaveText('3/5');

  // 3. Alongside the Stockton landing, stash the lumber.
  const docked = await page.evaluate(() =>
    (window as unknown as { __glpPort: PortHook }).__glpPort.dock('stockton_landing'),
  );
  expect(docked).toBe(true);
  const stash = page.getByTestId('stash-screen');
  await expect(stash).toBeVisible({ timeout: 15_000 });
  await page.getByTestId('stash-0').click({ modifiers: ['Shift'] });
  await expect(page.getByTestId('stash-store-row')).toHaveCount(1);
  await page.keyboard.press('Escape');
  await expect(stash).toHaveCount(0);
  await expect(page.getByTestId('first-week-count')).toHaveText('4/5');

  // 5. Out to the west edge's fog, take to the chart and set out for the Twin Ports.
  await page.keyboard.press('KeyF');
  await page.evaluate(() =>
    (
      window as unknown as { __glpTraffic: { place(x: number, z: number, deg?: number): void } }
    ).__glpTraffic.place(-3350, -2450, 270),
  );
  await expect(page.getByTestId('take-to-chart')).toBeVisible({ timeout: 15_000 });
  await page.getByTestId('take-to-chart').click();
  await expect(body).toHaveAttribute('data-mode', 'chart');
  expect(
    await page.evaluate(() =>
      (window as unknown as { __glpChart: ChartHook }).__glpChart.plot([
        [46.97, -91.6],
        [46.85, -91.95],
      ]),
    ),
  ).toBe('ok');
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('chart-status')).toContainText('Under way');
  await page.keyboard.press('KeyJ');
  for (const step of ['sell', 'contract', 'stash', 'rumor', 'voyage']) {
    await expect(page.getByTestId(`first-week-${step}`)).toHaveClass(/done/);
  }
  expect(errors).toEqual([]);
});

interface ShipyardHook {
  ship(): { classId: string; hull01: number; rigging01: number; upgrades: string[] };
  grant(cents: number): void;
  damage(hull01: number, rigging01: number): void;
  sailing(): string;
}

// Phase 4 piece G: Ashland's shipyard sells the T2 with the T1 in trade, fits an upgrade,
// and repairs her; at sea, K uses a patch kit from the lockers.
test('buys a T2 at Ashland, fits and repairs her, and patches the hull at sea', async ({
  page,
}) => {
  const errors = collectErrors(page);
  const body = page.locator('body');
  await page.goto('/?renderer=null&debug&harbor=ashland,2');
  await expect(body).toHaveAttribute('data-terrain', 'loaded');
  await page.waitForFunction(() => '__glpChart' in window);
  await page.evaluate(() => {
    const w = window as unknown as { __glpShipyard: ShipyardHook };
    w.__glpShipyard.grant(200_000);
  });
  const docked = await page.evaluate(() =>
    (window as unknown as { __glpPort: PortHook }).__glpPort.dock('ashland_city'),
  );
  expect(docked).toBe(true);
  const screen = page.getByTestId('port-screen');
  await expect(screen).toBeVisible({ timeout: 15_000 });

  await page.getByTestId('port-tab-shipyard').click();
  await expect(page.getByTestId('shipyard')).toBeVisible();
  await page.getByTestId('buy-hull-ship.t2_schooner').click();
  await expect(page.getByTestId('port-message')).toContainText("She's yours");
  const yard = (): Promise<ReturnType<ShipyardHook['ship']>> =>
    page.evaluate(() =>
      (window as unknown as { __glpShipyard: ShipyardHook }).__glpShipyard.ship(),
    );
  expect((await yard()).classId).toBe('ship.t2_schooner');
  expect(
    await page.evaluate(() =>
      (window as unknown as { __glpShipyard: ShipyardHook }).__glpShipyard.sailing(),
    ),
  ).toBe('ship.t2_schooner');

  await page.getByTestId('fit-upgrade.quality_canvas').click();
  await expect(page.getByTestId('upgrade-row-upgrade.quality_canvas')).toHaveClass(/selected/);
  expect((await yard()).upgrades).toEqual(['upgrade.quality_canvas']);

  // Damage her, then the yard makes her sound.
  await page.keyboard.press('Escape');
  await page.evaluate(() =>
    (window as unknown as { __glpShipyard: ShipyardHook }).__glpShipyard.damage(0.4, 0.6),
  );
  await page.keyboard.press('KeyP');
  await page.getByTestId('port-tab-shipyard').click();
  await page.getByTestId('repair-shipyard').click();
  expect(await yard()).toMatchObject({ hull01: 1, rigging01: 1 });

  // A patch kit from the chandlery, cast off, and K patches a damaged hull.
  await page.getByTestId('port-tab-chandlery').click();
  await page.getByTestId('store-store.patch_kit').click();
  await page.keyboard.press('KeyF');
  await expect(screen).toHaveCount(0);
  await page.evaluate(() =>
    (window as unknown as { __glpShipyard: ShipyardHook }).__glpShipyard.damage(0.5, 1),
  );
  await page.keyboard.press('KeyK');
  await expect(
    page.getByTestId('hud-status').filter({ hasText: 'Patched the hull: 70%' }),
  ).toHaveCount(1);
  expect((await yard()).hull01).toBeCloseTo(0.7, 2);
  expect(errors).toEqual([]);
});

interface LawHook {
  commit(crime: string, region?: string, kind?: string, identification?: string): unknown[];
  fileAll(): unknown[];
  region(): string | undefined;
  state(): {
    wanted: Record<string, { heat: number }>;
    reports: { inProgress: { witness: { kind: string } }[] };
  };
}

// Phase 5 piece A: a crime with a witness, its report on the way, the heat landing, and
// the law's slices kept through a reload (save v7).
test('files a witnessed crime as heat and keeps it through a reload', async ({ page }) => {
  const errors = collectErrors(page);
  const body = page.locator('body');
  await page.goto('/?renderer=null&debug&play');
  await expect(body).toHaveAttribute('data-terrain', 'loaded');
  await page.waitForFunction(() => '__glpChart' in window && '__glpLaw' in window);
  const before = await page.evaluate(() => {
    const h = (window as unknown as { __glpLaw: LawHook }).__glpLaw;
    h.commit('crime.smuggler_deal', 'region.apostles', 'none');
    h.commit('crime.smuggler_deal', 'region.apostles', 'keeper', 'ship');
    return { region: h.region(), state: h.state() };
  });
  expect(before.region).toMatch(/^region\./);
  expect(before.state.wanted['region.apostles']?.heat ?? 0).toBe(0);
  expect(before.state.reports.inProgress.map((r) => r.witness.kind)).toEqual(['keeper']);
  const filed = await page.evaluate(() => {
    const h = (window as unknown as { __glpLaw: LawHook }).__glpLaw;
    h.fileAll();
    return h.state();
  });
  expect(filed.wanted['region.apostles']?.heat).toBe(20);
  expect(filed.reports.inProgress).toEqual([]);

  await page.evaluate(() => {
    delete document.body.dataset['savedMode'];
    window.dispatchEvent(new Event('pagehide'));
  });
  await expect(body).toHaveAttribute('data-saved-mode', /.+/);
  await page.goto('/?renderer=null&debug&play');
  await expect(body).toHaveAttribute('data-save', 'loaded');
  await page.waitForFunction(() => '__glpChart' in window && '__glpLaw' in window);
  const after = await page.evaluate(() =>
    (window as unknown as { __glpLaw: LawHook }).__glpLaw.state(),
  );
  expect(after.wanted['region.apostles']?.heat).toBeGreaterThan(19);
  expect(errors).toEqual([]);
});
