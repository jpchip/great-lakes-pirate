import { expect, test, type Page } from '@playwright/test';

/**
 * Phase 7 piece I (plan 08 §20.4 row I; plan 15 §4.5, §11 Phase 7): the sounds ashore.
 * Walk Bayfield's pier and the planks sound underfoot; the docks' water plays at night and
 * the saloon's tune from inside it; a cosh is heard, and a guard who sees you is captioned
 * and brings the stealth layer up. Through the dev hooks and the audio's dataset readout.
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
  __glpFoot: {
    land(): Promise<string | undefined>;
    dock(key: string): boolean;
    hour(h: number): void;
    restock(): void;
    suspect(on: boolean | undefined): void;
    behindGuard(id: string, distM?: number): boolean;
    teleportLocal(x: number, z: number, headingDeg?: number): boolean;
    state(): { surface: string };
    crews(): { x: number; z: number }[];
    watch(): { guards: { id: string; state: string; x: number; z: number }[] };
  };
}

const foot = <T>(page: Page, fn: (f: Hooks['__glpFoot']) => T): Promise<T> =>
  page.evaluate(`(${fn.toString()})(window.__glpFoot)`) as Promise<T>;

test('footsteps on the planks, the docks at night, the saloon, a cosh and a shout', async ({
  page,
}) => {
  test.setTimeout(180_000);
  const errors = collectErrors(page);
  const body = page.locator('body');
  await page.goto('/?renderer=null&debug&play&seed=glp-2');
  await page.waitForFunction(() => '__glpFoot' in window);
  await foot(page, (f) => {
    f.hour(22);
    f.dock('bayfield_fish');
  });
  expect(await foot(page, (f) => f.land())).toBeUndefined();
  await foot(page, (f) => f.suspect(false));
  // A key down unlocks the audio and walks you up the pier.
  await page.keyboard.down('KeyW');
  await expect(body).toHaveAttribute('data-audio', 'running');
  await expect
    .poll(async () => Number(await body.getAttribute('data-foot-steps')), { timeout: 15_000 })
    .toBeGreaterThanOrEqual(3);
  await page.keyboard.up('KeyW');
  expect((await foot(page, (f) => f.state())).surface).toBe('wood');
  await expect(body).toHaveAttribute('data-foot-step', /^sfx\.foot\.step-wood-[12] 0\.\d\d$/);
  // The lake at the piles, after dark.
  await expect(body).toHaveAttribute('data-foot-beds', /\bdocks\b/);

  // Into the saloon while it's open: the room and its tune.
  const crews = await foot(page, (f) => f.crews());
  const table = crews[0] ?? { x: 22, z: 12 };
  await page.evaluate(
    ([x, z]) => (window as unknown as Hooks).__glpFoot.teleportLocal(x ?? 0, z ?? 0),
    [table.x + 0.6, table.z + 0.6],
  );
  await expect(body).toHaveAttribute('data-foot-beds', /\broom\b.*\btune\b/, { timeout: 10_000 });

  // A cosh from behind: heard.
  await foot(page, (f) => {
    f.restock();
    f.behindGuard('constable.lockup', 1.5);
  });
  await page.keyboard.press('Digit1');
  await expect(page.getByTestId('foot-tools').getByTestId('foot-prompt')).toContainText(
    'Knock out the constable',
  );
  await page.keyboard.press('KeyF');
  await expect(body).toHaveAttribute('data-foot-cue', 'sfx.foot.cosh');

  // Let the watch see a man standing over him: a shout with a caption, and the layer comes up.
  await foot(page, (f) => f.suspect(true));
  const other = (await foot(page, (f) => f.watch())).guards.find(
    (g) => g.id !== 'constable.lockup' && g.state === 'patrol',
  );
  expect(other).toBeDefined();
  if (!other) return;
  await page.evaluate(
    ([x, z]) => (window as unknown as Hooks).__glpFoot.teleportLocal(x ?? 0, z ?? 0),
    [other.x + 2.5, other.z],
  );
  // Both at once: he has you by the collar within a few seconds.
  await Promise.all([
    expect(
      page
        .getByTestId('caption')
        .filter({ hasText: /"Hey! Stop!"|A police whistle/ })
        .first(),
    ).toBeVisible({ timeout: 30_000 }),
    expect(body).toHaveAttribute('data-foot-beds', /\btension\b/, { timeout: 30_000 }),
  ]);
  expect(errors).toEqual([]);
});
