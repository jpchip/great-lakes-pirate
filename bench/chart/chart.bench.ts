import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';

test('chart redraw at 1920×1080', async ({ page }) => {
  const flags = [process.env.NIGHT && 'night', process.env.NOWEATHER && 'noweather'].filter(
    Boolean,
  );
  await page.goto(`/bench/chart/index.html${flags.length ? `?${flags.join('&')}` : ''}`);
  await expect(page.locator('body')).toHaveAttribute('data-bench', 'done', { timeout: 100_000 });
  const text = (await page.locator('#out').textContent()) ?? '';
  console.log(text);
  const file = join(import.meta.dirname, 'last-run.txt');
  writeFileSync(file, text + '\n');
  console.log(`Saved to ${file}`);
});
