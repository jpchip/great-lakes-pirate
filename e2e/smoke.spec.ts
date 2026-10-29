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

// Plan 15 §8: the sailing sounds decode up front and audio starts on the first key.
test('loads the sailing sounds and unlocks audio on the first key press', async ({ page }) => {
  const errors = collectErrors(page);
  const body = page.locator('body');
  await page.goto('/?renderer=null');
  await expect(body).toHaveAttribute('data-mode', 'sailing');
  await expect(body).toHaveAttribute('data-audio-bank', '14');
  await page.keyboard.press('KeyW');
  await expect(body).toHaveAttribute('data-audio', 'running');
  expect(errors).toEqual([]);
});
