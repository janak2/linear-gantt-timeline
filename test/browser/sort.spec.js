import { MOBILE, expect, openGantt, test } from './harness.js';

const stored = (worker, key) => worker.evaluate(async key => (await chrome.storage.local.get(key))[key], key);
const identifiers = frame => frame.locator('.row.issue .identifier, .row.parent-row .identifier');
const outline = frame => frame.locator('.row.subsection .label, .row.issue .identifier');

test.beforeEach(async ({ signIn }) => signIn());

test('sorts within each section and switches direction', async ({ page }) => {
  await page.goto(`https://linear.app${MOBILE}`);
  const frame = await openGantt(page);
  const direction = frame.getByRole('button', { name: 'Ascending' });
  await expect(frame.locator('#sort')).toHaveValue('default');
  await expect(frame.locator('#sort-direction')).toBeHidden();
  await expect(identifiers(frame)).toHaveText(['MOB-1', 'MOB-6', 'MOB-4', 'MOB-2', 'MOB-3', 'MOB-5']);

  await frame.getByLabel('Sort').selectOption('Due date');
  await expect(direction).toBeVisible();
  await expect(identifiers(frame)).toHaveText(['MOB-6', 'MOB-1', 'MOB-2', 'MOB-4', 'MOB-3', 'MOB-5']);
  await direction.click();
  await expect(frame.locator('#sort-direction')).toHaveText('Descending');
  await expect(frame.locator('#sort-direction')).toBeFocused();
  await expect(identifiers(frame)).toHaveText(['MOB-4', 'MOB-2', 'MOB-1', 'MOB-6', 'MOB-3', 'MOB-5']);
  await expect(frame.locator('.row.section .label')).toHaveText(['Milestones2', 'Scheduled4', 'Unscheduled1', 'Completed1']);

  await frame.getByLabel('Sort').selectOption('Default');
  await expect(frame.locator('#sort-direction')).toBeHidden();
  await expect(identifiers(frame)).toHaveText(['MOB-1', 'MOB-6', 'MOB-4', 'MOB-2', 'MOB-3', 'MOB-5']);
});

test('keeps assignee groups in place and sorts within them', async ({ page }) => {
  await page.goto(`https://linear.app${MOBILE}`);
  const frame = await openGantt(page);
  await frame.locator('#group-by').selectOption('assignee');
  await frame.locator('#sort').selectOption('priority');
  await expect(outline(frame)).toHaveText(['Maya Chen2', 'MOB-1', 'MOB-6', 'Sam Ortiz2', 'MOB-2', 'MOB-4', 'Unassigned1', 'MOB-3', 'Maya Chen1', 'MOB-5']);
  await frame.locator('#sort-direction').click();
  await expect(outline(frame)).toHaveText(['Maya Chen2', 'MOB-1', 'MOB-6', 'Sam Ortiz2', 'MOB-4', 'MOB-2', 'Unassigned1', 'MOB-3', 'Maya Chen1', 'MOB-5']);
});

test("orders parent groups by the parent's own due date and remembers the sort across reloads", async ({ page, worker }) => {
  await page.goto(`https://linear.app${MOBILE}`);
  let frame = await openGantt(page);
  await frame.locator('#group-by').selectOption('parent');
  await frame.locator('#sort').selectOption('dueDate');
  await expect(identifiers(frame)).toHaveText(['WEB-1', 'MOB-6', 'MOB-2', 'MOB-1', 'MOB-4', 'MOB-1', 'MOB-3', 'MOB-5']);
  await frame.locator('#sort-direction').click();
  await expect(identifiers(frame)).toHaveText(['MOB-1', 'MOB-4', 'WEB-1', 'MOB-2', 'MOB-6', 'MOB-1', 'MOB-3', 'MOB-5']);
  await expect.poll(() => stored(worker, 'view')).toEqual({ scale: 'week', collapsed: [], groupBy: 'parent', sort: 'dueDate', descending: true });

  await page.reload();
  frame = await openGantt(page);
  await expect(frame.locator('#sort')).toHaveValue('dueDate');
  await expect(frame.locator('#sort-direction')).toHaveText('Descending');
  await expect(frame.locator('#group-by')).toHaveValue('parent');
  await expect(identifiers(frame)).toHaveText(['MOB-1', 'MOB-4', 'WEB-1', 'MOB-2', 'MOB-6', 'MOB-1', 'MOB-3', 'MOB-5']);
});
