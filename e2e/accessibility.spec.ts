import { expect, test, type Page } from '@playwright/test';

/**
 * Accessibility (plan 13 §9): the settings' Accessibility tab puts the interface size, the
 * plain font and a colour-blind palette on the page at once and keeps them over a reload;
 * the Controls tab rebinds on foot and sets crouch to toggle.
 */

function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });
  return errors;
}

test('accessibility settings apply at once and survive a reload', async ({ page }) => {
  test.setTimeout(90_000);
  const errors = collectErrors(page);
  const html = page.locator('html');
  await page.goto('/?renderer=null&debug&play');
  await expect(page.getByTestId('hud-wind')).toBeVisible({ timeout: 20_000 });

  await page.keyboard.press('Escape');
  await page.getByTestId('tab-access').click();
  await page.getByTestId('setting-ui-scale').selectOption('1.3');
  await page.getByText('Plain font (instead of the period type)').click();
  await page.getByTestId('setting-color-mode').selectOption('redGreen');
  await expect(html).toHaveAttribute('data-font', 'plain');
  await expect(html).toHaveAttribute('data-color-mode', 'redGreen');
  const look = () =>
    page.evaluate(() => {
      const root = getComputedStyle(document.documentElement);
      const ui = document.getElementById('ui') as HTMLElement;
      return {
        scale: root.getPropertyValue('--ui-scale').trim(),
        red: root.getPropertyValue('--signal-red').trim(),
        zoom: getComputedStyle(ui).zoom,
        font: getComputedStyle(ui).fontFamily,
      };
    });
  expect(await look()).toMatchObject({ scale: '1.3', red: '#9c2a86', zoom: '1.3' });
  expect((await look()).font).toContain('system-ui');

  // On foot, crouch toggles, and its key is C until rebound.
  await page.getByTestId('tab-controls').click();
  await page.getByText('Crouch toggles instead of hold').click();
  await page.getByTestId('bind-onFoot-Crouch').click();
  await page.keyboard.press('KeyV');
  await expect(page.getByTestId('bind-onFoot-Crouch')).toContainText('V');
  // The helm keeps C for the shot.
  await expect(page.getByTestId('bind-CycleAmmo')).toContainText('C');
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('settings-menu')).toBeHidden();

  await page.waitForTimeout(300);
  await page.reload();
  await expect(page.getByTestId('hud-wind')).toBeVisible();
  await expect(html).toHaveAttribute('data-font', 'plain');
  await expect(html).toHaveAttribute('data-color-mode', 'redGreen');
  expect((await look()).zoom).toBe('1.3');
  await page.getByTestId('open-settings').click();
  await page.getByTestId('tab-controls').click();
  await expect(page.getByTestId('bind-onFoot-Crouch')).toContainText('V');

  // The prompts and keys on screen name the keys as bound: ashore at Bayfield, F (Interact)
  // moved to R, the keys line says V crouch and the prompt's key says R.
  await page.getByTestId('bind-onFoot-Interact').click();
  await page.keyboard.press('KeyR');
  await expect(page.getByTestId('bind-onFoot-Interact')).toContainText('R');
  await page.getByTestId('tab-camera').click();
  await expect(page.getByTestId('settings-menu')).toContainText('Manual sail trim (Q / E)');
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => '__glpFoot' in window);
  const landed = await page.evaluate(() => {
    const f = (
      window as unknown as {
        __glpFoot: { dock(k: string): boolean; land(): Promise<string | undefined> };
      }
    ).__glpFoot;
    f.dock('bayfield_city');
    return f.land();
  });
  expect(landed).toBeUndefined();
  await expect(page.getByTestId('foot-keys')).toContainText('V crouch');
  const prompt = page.getByTestId('foot-prompt').filter({ hasText: 'Go aboard' });
  await expect(prompt).toBeVisible();
  await expect(prompt.locator('.hud-key, .foot-key')).toHaveText('R');

  // Back to the game as authored.
  await page.getByTestId('open-settings').click();
  await page.getByTestId('tab-access').click();
  await page.getByTestId('setting-color-mode').selectOption('off');
  await expect(html).not.toHaveAttribute('data-color-mode', /.*/);
  expect(errors).toEqual([]);
});
