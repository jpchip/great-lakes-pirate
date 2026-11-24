import { devices, expect, test } from '@playwright/test';

/** A device's viewport, touch and mobile flags, without its browser type. */
function like(name: string): Omit<(typeof devices)[string], 'defaultBrowserType'> {
  const device = devices[name];
  if (!device) throw new Error(`No device ${name}`);
  const { defaultBrowserType, ...rest } = device;
  void defaultBrowserType;
  return rest;
}

// A phone or tablet gets the keyboard-and-mouse warning before the menu; a desktop never
// does. Dismissing it is remembered on that device.

test.describe('on a phone', () => {
  test.use(like('Pixel 7'));

  test('warns, carries on to the menu, and remembers', async ({ page }) => {
    await page.goto('/?renderer=null');
    await expect(page.getByTestId('mobile-warning')).toBeVisible();
    await expect(page.locator('body')).toHaveAttribute('data-mobile-warning', 'shown');
    await page.getByTestId('mobile-warning-continue').click();
    await expect(page.getByTestId('mobile-warning')).toHaveCount(0);
    await expect(page.locator('body')).toHaveAttribute('data-mode', 'mainMenu');
    await page.reload();
    await expect(page.locator('body')).toHaveAttribute('data-mode', 'mainMenu');
    await expect(page.getByTestId('mobile-warning')).toHaveCount(0);
  });
});

test.describe('on a tablet', () => {
  test.use(like('Galaxy Tab S4'));

  test('warns', async ({ page }) => {
    await page.goto('/?renderer=null');
    await expect(page.getByTestId('mobile-warning')).toBeVisible();
  });
});

test.describe('on a desktop', () => {
  test('does not warn', async ({ page }) => {
    await page.goto('/?renderer=null');
    await expect(page.locator('body')).toHaveAttribute('data-mode', 'mainMenu');
    await expect(page.getByTestId('mobile-warning')).toHaveCount(0);
  });
});

test.describe('on a touchscreen laptop', () => {
  // Chrome on a touchscreen laptop reports touch points, but its primary pointer is the
  // touchpad (fine, can hover). Playwright's hasTouch would emulate a touch-only device,
  // so only the touch points are faked here.
  test('does not warn', async ({ page }) => {
    await page.addInitScript(() =>
      Object.defineProperty(Navigator.prototype, 'maxTouchPoints', { get: () => 10 }),
    );
    await page.goto('/?renderer=null');
    expect(await page.evaluate(() => navigator.maxTouchPoints)).toBe(10);
    await expect(page.locator('body')).toHaveAttribute('data-mode', 'mainMenu');
    await expect(page.getByTestId('mobile-warning')).toHaveCount(0);
  });
});
