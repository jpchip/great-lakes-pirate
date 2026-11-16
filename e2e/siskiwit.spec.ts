import { expect, test, type Page } from '@playwright/test';

/**
 * Phase 8 piece D (plan 09 §16.4, exit criterion 8): a new Lumberjack's hideout is the
 * Siskiwit Bay logging camp. Anchor off its dock, row ashore onto the mainland pad, walk
 * the camp and open the stash at its strongbox. Through `?ashore=siskiwit` and the dev hooks.
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
    dock(key: string): boolean;
    teleport(x: number, z: number, y?: number): void;
    interact(): void;
    state(): {
      active: boolean;
      inBoat: boolean;
      prompt: string | undefined;
      at: { x: number; y: number; z: number };
    };
    island(): {
      island: string | undefined;
      colliders: number;
      pieces: { kind: string; x: number; z: number; top: number }[];
      strongbox: { x: number; y: number; z: number; hideout: string } | undefined;
    };
  };
}

const hooks = (page: Page) =>
  page.evaluate(() => {
    const f = (window as unknown as Hooks).__glpFoot;
    return { state: f.state(), island: f.island() };
  });

test('Siskiwit Bay: a Lumberjack lands at the logging camp and opens the stash', async ({
  page,
}) => {
  test.setTimeout(180_000);
  const errors = collectErrors(page);
  await page.goto(
    '/?renderer=null&debug&play&newrun=lumberjack&zone=zone.siskiwit&ashore=siskiwit',
  );
  await page.waitForFunction(() => '__glpFoot' in window);
  await expect(page.locator('body')).toHaveAttribute('data-zone', 'zone.siskiwit');
  // Anchored off the dock, the boat rowed in and run up on the beach.
  await expect(page.locator('body')).toHaveAttribute('data-ashore', 'foot', { timeout: 60_000 });
  let h = await hooks(page);
  expect(h.island.island).toBe('island.siskiwit_camp');
  const kinds = new Set(h.island.pieces.map((p) => p.kind));
  for (const k of ['wall', 'logs', 'lumber']) expect(kinds.has(k), k).toBe(true);

  // The Lumberjack's own hideout: F at the strongbox opens it.
  const box = h.island.strongbox;
  expect(box?.hideout).toBe('hideout.siskiwit');
  if (!box) return;
  await page.evaluate(([x, y, z]) => (window as unknown as Hooks).__glpFoot.teleport(x, z, y), [
    box.x + 1.3,
    box.y + 0.2,
    box.z,
  ] as const);
  await expect.poll(async () => (await hooks(page)).state.prompt).toBe('Open the stash');
  await page.evaluate(() => (window as unknown as Hooks).__glpFoot.interact());
  await expect(page.locator('body')).toHaveAttribute('data-stash', 'hideout.siskiwit');
  h = await hooks(page);
  expect(h.state.active).toBe(true);
  expect(errors).toEqual([]);
});

test('Siskiwit Bay: docked at the camp dock, Go ashore rows her onto the pad', async ({ page }) => {
  test.setTimeout(180_000);
  const errors = collectErrors(page);
  await page.goto('/?renderer=null&debug&play&newrun=lumberjack&zone=zone.siskiwit');
  await page.waitForFunction(() => '__glpFoot' in window);
  await expect(page.locator('body')).toHaveAttribute('data-zone', 'zone.siskiwit');
  const docked = await page.evaluate(() => (window as unknown as Hooks).__glpFoot.dock('siskiwit'));
  expect(docked).toBe(true);
  const ashore = page.getByTestId('hud-ashore');
  await expect(ashore).toBeVisible({ timeout: 60_000 });
  await expect(ashore).toContainText('Go ashore');
  await ashore.click();
  await expect.poll(async () => (await hooks(page)).state.inBoat, { timeout: 60_000 }).toBe(true);
  expect(errors).toEqual([]);
});
