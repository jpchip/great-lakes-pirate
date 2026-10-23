import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';

test('S6 save size and speed', async ({ page }) => {
  await page.goto('/bench/s6/index.html');
  await expect(page.locator('body')).not.toHaveAttribute('data-s6', 'running', {
    timeout: 280_000,
  });
  const text = (await page.locator('#out').textContent()) ?? '';
  await expect(page.locator('body')).toHaveAttribute('data-s6', 'done');
  const file = join(import.meta.dirname, 'last-run.json');
  writeFileSync(file, text + '\n');
  console.log(text);
  console.log(`Saved to ${file}`);
});
