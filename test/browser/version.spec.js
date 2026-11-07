import { MOBILE, expect, openGantt, test } from './harness.js';

test('shows the installed version at the right of the legend in both themes', async ({ page, worker, signIn }, testInfo) => {
  const version = await worker.evaluate(() => chrome.runtime.getManifest().version);
  await signIn();
  await page.goto(`https://linear.app${MOBILE}`);
  const frame = await openGantt(page);
  const label = frame.getByLabel('Extension version');
  await expect(label).toHaveText(`v${version}`);
  for (const theme of ['dark', 'light']) {
    await page.evaluate(theme => window.setTheme(theme), theme);
    await expect(frame.locator('html')).toHaveAttribute('data-theme', theme);
    const footer = await frame.locator('#legend').boundingBox();
    const box = await label.boundingBox();
    const milestone = await frame.locator('#legend span').nth(3).boundingBox();
    expect(box.x).toBeGreaterThan(milestone.x + milestone.width);
    expect(footer.x + footer.width - box.x - box.width).toBeCloseTo(16, 0);
    expect(box.y).toBe(milestone.y);
    await page.mouse.move(0, 0);
    await page.screenshot({ path: testInfo.outputPath(`version-${theme}.png`) });
    await frame.locator('#legend').screenshot({ path: testInfo.outputPath(`version-legend-${theme}.png`) });
  }
});