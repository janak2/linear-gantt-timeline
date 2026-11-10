import { MOBILE, expect, filterBy, openGantt, row, test } from './harness.js';

const stored = (worker, key) => worker.evaluate(async key => (await chrome.storage.local.get(key))[key], key);
const identifiers = frame => frame.locator('.row.issue .identifier, .row.parent-row .identifier');
const outline = frame => frame.locator('.row.subsection .label, .row.issue .identifier');

test.beforeEach(async ({ signIn }) => signIn());

test('sorts the shared issue list and switches direction', async ({ page }) => {
  await page.goto(`https://linear.app${MOBILE}`);
  const frame = await openGantt(page);
  const direction = frame.getByRole('button', { name: 'Ascending' });
  await expect(frame.locator('#sort')).toHaveValue('default');
  await expect(frame.locator('#sort-direction')).toBeHidden();
  await expect(identifiers(frame)).toHaveText(['MOB-1', 'MOB-6', 'MOB-4', 'MOB-2', 'MOB-3', 'MOB-5']);

  await frame.getByLabel('Sort').selectOption('Due date');
  await expect(direction).toBeVisible();
  await expect(identifiers(frame)).toHaveText(['MOB-5', 'MOB-6', 'MOB-1', 'MOB-2', 'MOB-4', 'MOB-3']);
  await direction.click();
  await expect(frame.locator('#sort-direction')).toHaveText('Descending');
  await expect(frame.locator('#sort-direction')).toBeFocused();
  await expect(identifiers(frame)).toHaveText(['MOB-4', 'MOB-2', 'MOB-1', 'MOB-6', 'MOB-5', 'MOB-3']);
  await expect(frame.locator('.row.section .label')).toHaveText(['Milestones2', 'Issues6']);

  await frame.getByLabel('Sort').selectOption('Default');
  await expect(frame.locator('#sort-direction')).toBeHidden();
  await expect(identifiers(frame)).toHaveText(['MOB-1', 'MOB-6', 'MOB-4', 'MOB-2', 'MOB-3', 'MOB-5']);
});

test('keeps assignee groups in place and sorts within them', async ({ page }) => {
  await page.goto(`https://linear.app${MOBILE}`);
  const frame = await openGantt(page);
  await frame.locator('#group-by').selectOption('assignee');
  await frame.locator('#sort').selectOption('priority');
  await expect(outline(frame)).toHaveText(['Maya Chen3', 'MOB-1', 'MOB-6', 'MOB-5', 'Sam Ortiz2', 'MOB-2', 'MOB-4', 'Unassigned1', 'MOB-3']);
  await frame.locator('#sort-direction').click();
  await expect(outline(frame)).toHaveText(['Maya Chen3', 'MOB-1', 'MOB-6', 'MOB-5', 'Sam Ortiz2', 'MOB-4', 'MOB-2', 'Unassigned1', 'MOB-3']);
});

test("orders parent groups by the parent's own due date and remembers the sort across reloads", async ({ page, worker }) => {
  await page.goto(`https://linear.app${MOBILE}`);
  let frame = await openGantt(page);
  await frame.locator('#group-by').selectOption('parent');
  await frame.locator('#sort').selectOption('dueDate');
  await expect(identifiers(frame)).toHaveText(['MOB-5', 'WEB-1', 'MOB-6', 'MOB-2', 'MOB-1', 'MOB-4', 'MOB-3']);
  await frame.locator('#sort-direction').click();
  await expect(identifiers(frame)).toHaveText(['MOB-1', 'MOB-4', 'MOB-3', 'WEB-1', 'MOB-2', 'MOB-6', 'MOB-5']);
  await expect.poll(() => stored(worker, 'view')).toEqual({ scale: 'week', collapsed: [], groupBy: 'parent', sort: 'dueDate', descending: true });

  await page.reload();
  frame = await openGantt(page);
  await expect(frame.locator('#sort')).toHaveValue('dueDate');
  await expect(frame.locator('#sort-direction')).toHaveText('Descending');
  await expect(frame.locator('#group-by')).toHaveValue('parent');
  await expect(identifiers(frame)).toHaveText(['MOB-1', 'MOB-4', 'MOB-3', 'WEB-1', 'MOB-2', 'MOB-6', 'MOB-5']);
});

test('re-sorts immediately after an inline status edit', async ({ page }) => {
  await page.goto(`https://linear.app${MOBILE}`);
  const frame = await openGantt(page);
  await frame.locator('#sort').selectOption('status');
  await expect(identifiers(frame)).toHaveText(['MOB-6', 'MOB-2', 'MOB-3', 'MOB-1', 'MOB-4', 'MOB-5']);
  const status = row(frame, 'MOB-6').getByLabel('Status for MOB-6');
  await status.focus();
  await status.selectOption({ label: 'In Review' });
  await status.press('Enter');
  await expect(row(frame, 'MOB-6').locator('.save-state')).toHaveText('Saved');
  await expect(identifiers(frame)).toHaveText(['MOB-2', 'MOB-3', 'MOB-1', 'MOB-4', 'MOB-6', 'MOB-5']);
});

test('refreshes external priority edits when reopening Gantt without resetting the view', async ({ page, linear }) => {
  await page.goto(`https://linear.app${MOBILE}`);
  const frame = await openGantt(page);
  await frame.locator('#sort').selectOption('priority');
  await frame.locator('#sort-direction').click();
  await filterBy(frame, 'assignee', 'Sam Ortiz');
  await expect(identifiers(frame)).toHaveText(['MOB-4', 'MOB-2']);
  await frame.locator('#chart').evaluate(chart => { chart.scrollLeft = 100; });
  await page.locator('header .tabs a', { hasText: 'Issues' }).click();
  linear.issue('MOB-4').priority = 1;
  linear.issue('MOB-2').priority = 3;
  await openGantt(page);
  await expect(identifiers(frame)).toHaveText(['MOB-2', 'MOB-4']);
  await expect(frame.locator('#sort')).toHaveValue('priority');
  await expect(frame.locator('#sort-direction')).toHaveText('Descending');
  await expect(frame.locator('#assignee')).toHaveText('Sam Ortiz');
  expect(await frame.locator('#chart').evaluate(chart => chart.scrollLeft)).toBe(100);
});

test('periodically refreshes external status edits and moves completed tickets', async ({ page, linear }) => {
  await page.clock.install();
  await page.goto(`https://linear.app${MOBILE}`);
  const frame = await openGantt(page);
  await frame.locator('#sort').selectOption('status');
  linear.issue('MOB-6').state = linear.teams[0].states.find(state => state.id === 'review');
  linear.issue('MOB-2').state = linear.issue('MOB-5').state;
  await page.clock.fastForward(30_000);
  await expect(identifiers(frame)).toHaveText(['MOB-3', 'MOB-1', 'MOB-4', 'MOB-6', 'MOB-5', 'MOB-2']);
  await expect(frame.locator('.row.section .label')).toHaveText(['Milestones2', 'Issues6']);
});

test('does not poll while Gantt is closed or replace a focused edit', async ({ page, linear }) => {
  await page.clock.install();
  await page.goto(`https://linear.app${MOBILE}`);
  const frame = await openGantt(page);
  await frame.locator('#sort').selectOption('priority');
  await frame.evaluate(() => {
    window.ganttClosed = false;
    addEventListener('message', event => {
      if (event.data?.type === 'linear-gantt:active' && !event.data.active) window.ganttClosed = true;
    });
  });
  await page.locator('header .tabs a', { hasText: 'Issues' }).click();
  await expect.poll(() => frame.evaluate(() => window.ganttClosed)).toBe(true);
  const count = linear.operations('GanttProjectIssues').length;
  await page.clock.fastForward(30_000);
  expect(linear.operations('GanttProjectIssues')).toHaveLength(count);
  await openGantt(page);
  await expect.poll(() => linear.operations('GanttProjectIssues').length).toBe(count + 1);
  const input = row(frame, 'MOB-2').locator('.due-input');
  await input.focus();
  linear.issue('MOB-4').priority = 1;
  await page.clock.fastForward(30_000);
  expect(linear.operations('GanttProjectIssues')).toHaveLength(count + 1);
  await expect(input).toBeFocused();
  await frame.locator('#sort').focus();
  await page.clock.fastForward(30_000);
  await expect(identifiers(frame)).toHaveText(['MOB-4', 'MOB-2', 'MOB-1', 'MOB-3', 'MOB-6', 'MOB-5']);
});

test('keeps the chart on a transient refresh failure and retries when the window regains focus', async ({ page, linear }) => {
  await page.clock.install();
  await page.goto(`https://linear.app${MOBILE}`);
  const frame = await openGantt(page);
  await frame.locator('#sort').selectOption('priority');
  linear.respondOnce('GanttProjectIssues', { status: 500, body: {} });
  await page.clock.fastForward(30_000);
  await expect.poll(() => linear.operations('GanttProjectIssues').length).toBe(2);
  await expect(identifiers(frame)).toHaveText(['MOB-2', 'MOB-1', 'MOB-4', 'MOB-3', 'MOB-6', 'MOB-5']);
  await expect(frame.locator('#gate')).toBeHidden();
  linear.issue('MOB-4').priority = 1;
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await page.clock.fastForward(100);
  await expect(identifiers(frame)).toHaveText(['MOB-4', 'MOB-2', 'MOB-1', 'MOB-3', 'MOB-6', 'MOB-5']);
});
