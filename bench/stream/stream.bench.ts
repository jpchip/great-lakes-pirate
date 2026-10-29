import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';

test('zone streaming along the Bayfield–Ashland–Outer Island route', async ({ page }) => {
  const quality = process.env.QUALITY ?? 'medium';
  const speed = process.env.SPEED ?? '8';
  await page.goto(`/bench/stream/index.html?quality=${quality}&speed=${speed}`);
  await expect(page.locator('body')).not.toHaveAttribute('data-stream', 'running', {
    timeout: 880_000,
  });
  const text = (await page.locator('#out').textContent()) ?? '';
  console.log(text);
  await expect(page.locator('body')).toHaveAttribute('data-stream', 'done');
  const file = join(import.meta.dirname, `last-run-${quality}.json`);
  writeFileSync(file, text + '\n');
  console.log(`Saved to ${file}`);
});
