import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';

/**
 * Player save export and import (plan 16 §9): Export run on the pause menu downloads the run,
 * never in danger; Import run on the main menu brings it back when there's no run, and the
 * run's Hall of Captains record says "Transferred".
 */

function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });
  return errors;
}

async function boot(page: Page): Promise<void> {
  await page.goto('/?renderer=null&debug&play');
  await expect(page.locator('body')).toHaveAttribute('data-terrain', 'loaded');
  await page.waitForFunction(() => '__glpChart' in window);
}

test('exports a run, refuses in danger, and imports it as Transferred', async ({ page }) => {
  const errors = collectErrors(page);
  const body = page.locator('body');
  await boot(page);

  // In danger, the export is refused.
  await page.evaluate(() =>
    (window as unknown as { __glpChart: { setPursued(on: boolean): void } }).__glpChart.setPursued(
      true,
    ),
  );
  await expect(body).toHaveAttribute('data-danger', 'on');
  await page.getByTestId('open-settings').click();
  await page.getByTestId('settings-export').click();
  await expect(page.getByTestId('settings-export-note')).toContainText('law on your tail');
  await page.getByTestId('settings-close').click();
  await page.evaluate(() =>
    (window as unknown as { __glpChart: { setPursued(on: boolean): void } }).__glpChart.setPursued(
      false,
    ),
  );
  await expect(body).toHaveAttribute('data-danger', 'off');

  // Safe again: the run downloads.
  await page.getByTestId('open-settings').click();
  const download = page.waitForEvent('download');
  await page.getByTestId('settings-export').click();
  const file = await download;
  expect(file.suggestedFilename()).toMatch(/^Captain-.+\.glprun$/);
  await expect(page.getByTestId('settings-export-note')).toContainText('Saved as');
  const path = await file.path();
  const text = readFileSync(path, 'utf8');
  expect(JSON.parse(text)).toMatchObject({ format: 'glp-run' });

  // The run ends; the menu offers Import run with nothing to continue.
  await page.getByTestId('settings-abandon').click();
  await page.getByTestId('settings-abandon-confirm').click();
  await expect(page.getByTestId('end-screen')).toBeVisible();
  await page.goto('/?renderer=null');
  await expect(page.getByTestId('menu-continue')).toHaveCount(0);

  // A file that isn't a run is refused and nothing changes.
  await page.getByTestId('menu-import-file').setInputFiles({
    name: 'notes.glprun',
    mimeType: 'application/json',
    buffer: Buffer.from('{"hello":1}'),
  });
  await expect(page.getByTestId('menu-import-note')).toContainText(
    "isn't a Great Lakes Pirate run",
  );

  // The exported run comes back, to continue.
  await page.getByTestId('menu-import-file').setInputFiles(path);
  await expect(page.getByTestId('saved-run')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId('menu-import')).toHaveCount(0);
  await page.getByTestId('menu-continue').click();
  await expect(body).toHaveAttribute('data-save', 'loaded');

  // Ended, its Hall record says it was transferred.
  await page.getByTestId('open-settings').click();
  await page.getByTestId('settings-abandon').click();
  await page.getByTestId('settings-abandon-confirm').click();
  await expect(page.getByTestId('end-screen')).toBeVisible();
  await page.getByTestId('end-menu').click();
  await page.getByTestId('menu-hall').click();
  await expect(page.getByTestId('hall-transferred').first()).toBeVisible();
  expect(errors).toEqual([]);
});
