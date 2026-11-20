import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';

test('zone streaming along a zone route', async ({ page }) => {
  const zone = process.env.ZONE ?? 'apostles';
  const quality = process.env.QUALITY ?? 'medium';
  const speed = process.env.SPEED ?? '8';
  const winter = process.env.WINTER === '1' ? '&winter=1' : '';
  await page.goto(
    `/bench/stream/index.html?quality=${quality}&speed=${speed}&zone=${zone}${winter}`,
  );
  await expect(page.locator('body')).not.toHaveAttribute('data-stream', 'running', {
    timeout: 880_000,
  });
  const text = (await page.locator('#out').textContent()) ?? '';
  console.log(text);
  await expect(page.locator('body')).toHaveAttribute('data-stream', 'done');
  const file = join(
    import.meta.dirname,
    (zone === 'apostles' ? `last-run-${quality}` : `last-run-${zone}-${quality}`) +
      (winter ? '-winter.json' : '.json'),
  );
  writeFileSync(file, text + '\n');
  console.log(`Saved to ${file}`);
});
