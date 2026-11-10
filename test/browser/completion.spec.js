import { MOBILE, expect, openGantt, row, test } from './harness.js';

test.beforeEach(async ({ signIn }) => signIn());

test('shows actual completion separately from the due date in the unified list', async ({ page, linear }, testInfo) => {
  linear.issue('MOB-2').state = linear.teams[0].states.find(state => state.id === 'canceled');
  linear.issue('MOB-5').completedAt = '2026-11-09T17:00:00Z';
  linear.issue('MOB-5').dueDate = '2026-11-12';
  await page.goto(`https://linear.app${MOBILE}`);
  const frame = await openGantt(page);
  await frame.locator('#sort').selectOption('status');
  await frame.locator('#sort-direction').click();
  await expect(frame.locator('.row.section .label')).toHaveText(['Milestones2', 'Issues6']);
  await expect(frame.locator('.row.issue .identifier')).toHaveText(['MOB-1', 'MOB-4', 'MOB-6', 'MOB-3', 'MOB-2', 'MOB-5']);
  const completed = row(frame, 'MOB-5');
  await expect(completed.locator('time')).toHaveText('Completed Nov 9, 2026');
  await expect(completed.locator('time')).toHaveAttribute('datetime', '2026-11-09T17:00:00Z');
  await expect(completed.locator('.due-input')).toHaveValue('2026-11-12');
  await expect(completed.locator('.bar')).toHaveAttribute('title', /Due: Nov 12, 2026\nCompleted: Nov 9, 2026/);
  await expect(row(frame, 'MOB-1').locator('time')).toHaveCount(0);
  await expect(row(frame, 'MOB-2').locator('time')).toHaveCount(0);
  for (const theme of ['dark', 'light']) {
    await page.evaluate(theme => window.setTheme(theme), theme);
    await expect(frame.locator('html')).toHaveAttribute('data-theme', theme);
    await page.mouse.move(0, 0);
    await page.screenshot({ path: testInfo.outputPath(`unified-issues-${theme}.png`) });
    await completed.locator('.label').screenshot({ path: testInfo.outputPath(`completion-detail-${theme}.png`) });
  }
});

test('does not invent a completion date when Linear has none', async ({ page, linear }) => {
  linear.issue('MOB-5').completedAt = null;
  await page.goto(`https://linear.app${MOBILE}`);
  const frame = await openGantt(page);
  await expect(row(frame, 'MOB-5').locator('time')).toHaveCount(0);
});

test.describe('completion date in the local time zone', () => {
  test.use({ timezoneId: 'Pacific/Pago_Pago' });
  test('shows the local day, including on completed tickets with no due date', async ({ page, linear }) => {
    linear.issue('MOB-5').completedAt = '2026-11-10T02:00:00Z';
    linear.issue('MOB-5').dueDate = null;
    await page.goto(`https://linear.app${MOBILE}`);
    const frame = await openGantt(page);
    await expect(row(frame, 'MOB-5').locator('time')).toHaveText('Completed Nov 9, 2026');
  });
});