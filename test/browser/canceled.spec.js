import { MOBILE, expect, filterBy, openGantt, row, test } from './harness.js';

const sections = frame => frame.locator('.row.section .label');
const identifiers = frame => frame.locator('.row.issue .identifier');

test.beforeEach(async ({ signIn }) => signIn());

test('keeps finished tickets below active work in one list when sorting status descending', async ({ page, linear }) => {
  const canceled = linear.teams[0].states.find(state => state.id === 'canceled');
  linear.issue('MOB-2').state = canceled;
  linear.issue('MOB-3').state = canceled;
  await page.goto(`https://linear.app${MOBILE}`);
  const frame = await openGantt(page);
  await expect(sections(frame)).toHaveText(['Milestones2', 'Issues6']);
  await expect(identifiers(frame)).toHaveText(['MOB-1', 'MOB-6', 'MOB-4', 'MOB-5', 'MOB-2', 'MOB-3']);
  await frame.locator('#sort').selectOption('status');
  await expect(identifiers(frame)).toHaveText(['MOB-6', 'MOB-1', 'MOB-4', 'MOB-5', 'MOB-2', 'MOB-3']);
  await frame.locator('#sort-direction').click();
  await expect(identifiers(frame)).toHaveText(['MOB-1', 'MOB-4', 'MOB-6', 'MOB-2', 'MOB-3', 'MOB-5']);
  await expect(sections(frame)).toHaveText(['Milestones2', 'Issues6']);

  const toggle = frame.locator('.section-toggle', { hasText: /^Issues/ });
  await toggle.click();
  await expect(identifiers(frame)).toHaveCount(0);
  await toggle.click();
  await filterBy(frame, 'status', 'Canceled');
  await expect(sections(frame)).toHaveText(['Milestones2', 'Issues2']);
  await expect(identifiers(frame)).toHaveText(['MOB-2', 'MOB-3']);
});

test('reorders canceled tickets in the same list after saving a status change', async ({ page }) => {
  await page.goto(`https://linear.app${MOBILE}`);
  const frame = await openGantt(page);
  await frame.locator('#sort').selectOption('status');
  await frame.locator('#sort-direction').click();
  const status = row(frame, 'MOB-2').getByLabel('Status for MOB-2');
  await status.focus();
  await status.selectOption('canceled');
  await status.press('Enter');
  await expect(row(frame, 'MOB-2').locator('.save-state')).toHaveText('Saved');
  await expect(sections(frame)).toHaveText(['Milestones2', 'Issues6']);
  await expect(identifiers(frame)).toHaveText(['MOB-1', 'MOB-4', 'MOB-6', 'MOB-3', 'MOB-2', 'MOB-5']);

  await status.focus();
  await status.selectOption('todo');
  await status.press('Enter');
  await expect(row(frame, 'MOB-2').locator('.save-state')).toHaveText('Saved');
  await expect(sections(frame)).toHaveText(['Milestones2', 'Issues6']);
  await expect(identifiers(frame)).toHaveText(['MOB-1', 'MOB-4', 'MOB-6', 'MOB-2', 'MOB-3', 'MOB-5']);
});