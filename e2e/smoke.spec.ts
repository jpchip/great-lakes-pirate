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
  await page.goto('/?renderer=null');
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

  await page.goto('/?renderer=null');
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
  await page.goto('/?renderer=null');
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
  await page.goto('/?renderer=null');
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

// Plan 15 §8: the sailing and world sounds decode up front (14 each) and audio starts on
// the first key.
test('loads the sailing and world sounds and unlocks audio on the first key press', async ({
  page,
}) => {
  const errors = collectErrors(page);
  const body = page.locator('body');
  await page.goto('/?renderer=null');
  await expect(body).toHaveAttribute('data-mode', 'sailing');
  await expect(body).toHaveAttribute('data-audio-bank', '28');
  await page.keyboard.press('KeyW');
  await expect(body).toHaveAttribute('data-audio', 'running');
  expect(errors).toEqual([]);
});

// Plan 15 §7, Phase 2 piece H: the volume sliders are on the settings screen and persist.
test('sets a volume on the settings screen and keeps it after a reload', async ({ page }) => {
  const errors = collectErrors(page);
  const body = page.locator('body');
  await page.goto('/?renderer=null');
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
  await page.goto('/?renderer=null');
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
  await page.goto('/?renderer=null&debug');
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

interface ChartHook {
  plot(points: [number, number][]): string;
  secondsPerHour(s: number): void;
  setPursued(on: boolean): void;
}

/** Answers whatever the lookouts call until `done` holds: avoid where offered, else engage. */
async function sailThrough(page: Page, done: () => Promise<boolean>): Promise<void> {
  for (let i = 0; i < 240 && !(await done()); i++) {
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
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('chart-status')).toContainText('Under way');

  // Saved on the chart with the voyage; a reload comes back under way.
  await page.evaluate(() => window.dispatchEvent(new Event('pagehide')));
  await expect(body).toHaveAttribute('data-saved-mode', 'chart');
  await page.goto('/?renderer=null&debug');
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
  // The Twin Ports' east entry (data/zones.json), heading west.
  await expect(body).toHaveAttribute('data-saved-pose', /^1700\.\d\d,-100\.\d\d,4\.71\d\d$/);

  // M in open water is a look: the world holds and there's no setting out from here.
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
