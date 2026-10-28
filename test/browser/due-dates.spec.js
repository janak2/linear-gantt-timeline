import { MOBILE, WEBSITE, drag, expect, filterBy, ganttTab, openGantt, row, shift, test, today } from './harness.js';

const DAY_PX = 36;
const stored = (worker, key) => worker.evaluate(async key => (await chrome.storage.local.get(key))[key], key);

async function dayScale(page) {
  const frame = await openGantt(page);
  await frame.locator('[data-scale="day"]').click();
  await expect(row(frame, 'MOB-1')).toBeVisible();
  return frame;
}

test.beforeEach(async ({ signIn }) => signIn());

test('drags the right edge of a bar to change the due date', async ({ page, linear }) => {
  await page.goto(`https://linear.app${MOBILE}`);
  const frame = await dayScale(page);
  const bar = row(frame, 'MOB-1').locator('.bar');
  await expect(bar.locator('.handle')).toHaveCount(1);
  const before = await bar.boundingBox();

  await drag(page, bar.locator('.handle'), 3 * DAY_PX);
  await expect(row(frame, 'MOB-1').locator('.save-state')).toHaveText('Saved');
  const update = linear.operations('GanttUpdateDueDate');
  expect(update).toHaveLength(1);
  expect(update[0].variables).toEqual({ id: 'project-mobile-issue-1', dueDate: shift(today(), 8) });
  await expect(row(frame, 'MOB-1').locator('.due-input')).toHaveValue(shift(today(), 8));

  const after = await row(frame, 'MOB-1').locator('.bar').boundingBox();
  expect(after.x).toBeCloseTo(before.x, 0);
  expect(after.width).toBeCloseTo(before.width + 3 * DAY_PX, 0);
});

test('the start edge cannot be dragged', async ({ page, linear }) => {
  await page.goto(`https://linear.app${MOBILE}`);
  const frame = await dayScale(page);
  const bar = row(frame, 'MOB-1').locator('.bar');
  const box = await bar.boundingBox();
  await page.mouse.move(box.x + 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x - 3 * DAY_PX, box.y + box.height / 2, { steps: 4 });
  await page.mouse.up();
  expect(await row(frame, 'MOB-1').locator('.bar').boundingBox()).toEqual(box);
  expect(linear.operations('GanttUpdateDueDate')).toHaveLength(0);
});

test('drags the due-date marker of an issue that has not started', async ({ page, linear }) => {
  await page.goto(`https://linear.app${MOBILE}`);
  const frame = await dayScale(page);
  await drag(page, row(frame, 'MOB-2').locator('.marker'), -2 * DAY_PX);
  await expect(row(frame, 'MOB-2').locator('.save-state')).toHaveText('Saved');
  expect(linear.issue('MOB-2').dueDate).toBe(shift(today(), 8));
});

test('Escape cancels a drag', async ({ page, linear }) => {
  await page.goto(`https://linear.app${MOBILE}`);
  const frame = await dayScale(page);
  const marker = row(frame, 'MOB-2').locator('.marker');
  const box = await marker.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 4 * DAY_PX, box.y + box.height / 2, { steps: 4 });
  await page.keyboard.press('Escape');
  await page.mouse.up();
  await expect(row(frame, 'MOB-2').locator('.due-input')).toHaveValue(shift(today(), 10));
  expect(linear.operations('GanttUpdateDueDate')).toHaveLength(0);
});

test('sets a due date with the date picker and moves the issue out of Unscheduled', async ({ page, linear }) => {
  await page.goto(`https://linear.app${MOBILE}`);
  const frame = await openGantt(page);
  const target = shift(today(), 20);
  await row(frame, 'MOB-3').locator('.due-input').fill(target);
  await row(frame, 'MOB-3').locator('.due-input').press('Enter');
  await expect(row(frame, 'MOB-3').locator('.save-state')).toHaveText('Saved');
  expect(linear.issue('MOB-3').dueDate).toBe(target);
  await expect(frame.locator('.row.section .label')).toHaveText(['Milestones2', 'Scheduled5', 'Completed1']);
  await expect(row(frame, 'MOB-3').locator('.marker')).toHaveCount(1);
});

test('clears a due date', async ({ page, linear }) => {
  await page.goto(`https://linear.app${MOBILE}`);
  const frame = await openGantt(page);
  await row(frame, 'MOB-2').locator('.clear').click();
  await expect(row(frame, 'MOB-2').locator('.save-state')).toHaveText('Saved');
  expect(linear.issue('MOB-2').dueDate).toBe(null);
  expect(linear.operations('GanttUpdateDueDate')[0].variables).toEqual({ id: 'project-mobile-issue-2', dueDate: null });
  await expect(frame.locator('.row.section .label')).toHaveText(['Milestones2', 'Scheduled3', 'Unscheduled2', 'Completed1']);
  await expect(row(frame, 'MOB-2').locator('.clear')).toBeDisabled();
});

test('marks overdue issues', async ({ page }) => {
  await page.goto(`https://linear.app${MOBILE}`);
  const frame = await openGantt(page);
  await expect(row(frame, 'MOB-6').locator('.due-input')).toHaveClass(/overdue/);
  await expect(row(frame, 'MOB-5').locator('.due-input')).not.toHaveClass(/overdue/);
  await expect(row(frame, 'MOB-1').locator('.due-input')).not.toHaveClass(/overdue/);
});

test('restores the previous due date when a save fails', async ({ page, linear }) => {
  await page.goto(`https://linear.app${MOBILE}`);
  const frame = await dayScale(page);
  const before = await row(frame, 'MOB-1').locator('.bar').boundingBox();
  linear.respondOnce('GanttUpdateDueDate', { status: 500, body: {} });
  await drag(page, row(frame, 'MOB-1').locator('.handle'), 2 * DAY_PX);
  await expect(row(frame, 'MOB-1').locator('.save-state')).toHaveText('Not saved');
  await expect(row(frame, 'MOB-1').locator('.due-input')).toHaveValue(shift(today(), 5));
  const after = await row(frame, 'MOB-1').locator('.bar').boundingBox();
  expect([after.x, after.width]).toEqual([before.x, before.width]);
  await expect(frame.locator('#notice')).toContainText('HTTP 500');
  expect(linear.issue('MOB-1').dueDate).toBe(shift(today(), 5));
});

test('shows permission and rate-limit errors', async ({ page, linear }) => {
  await page.goto(`https://linear.app${MOBILE}`);
  const frame = await openGantt(page);
  linear.respondOnce('GanttUpdateDueDate', { status: 400, body: { errors: [{ extensions: { code: 'FORBIDDEN', userPresentableMessage: 'You cannot edit issues in this team.' } }] } });
  await row(frame, 'MOB-2').locator('.clear').click();
  await expect(frame.locator('#notice')).toHaveText('MOB-2: You cannot edit issues in this team.');
  await expect(row(frame, 'MOB-2').locator('.save-state')).toHaveAttribute('title', 'You cannot edit issues in this team.');
  await expect(row(frame, 'MOB-2').locator('.due-input')).toHaveValue(shift(today(), 10));

  linear.respondOnce('GanttIssue', { status: 429, body: { errors: [{ extensions: { code: 'RATELIMITED' } }] }, headers: { 'Retry-After': '20' } });
  await row(frame, 'MOB-2').locator('.clear').click();
  await expect(frame.locator('#notice')).toHaveText("MOB-2: Linear's rate limit was reached. Try again in 20 seconds.");
  expect(linear.issue('MOB-2').dueDate).toBe(shift(today(), 10));
});

test('does not overwrite a due date someone else changed', async ({ page, linear }) => {
  await page.goto(`https://linear.app${MOBILE}`);
  const frame = await openGantt(page);
  await expect(row(frame, 'MOB-2').locator('.due-input')).toHaveValue(shift(today(), 10));
  linear.issue('MOB-2').dueDate = shift(today(), 15);
  await row(frame, 'MOB-2').locator('.due-input').fill(shift(today(), 11));
  await row(frame, 'MOB-2').locator('.due-input').press('Enter');
  await expect(row(frame, 'MOB-2').locator('.save-state')).toHaveText('Not saved');
  await expect(frame.locator('#notice')).toContainText('Someone else changed this due date in Linear');
  await expect(row(frame, 'MOB-2').locator('.due-input')).toHaveValue(shift(today(), 15));
  expect(linear.operations('GanttUpdateDueDate')).toHaveLength(0);
  expect(linear.issue('MOB-2').dueDate).toBe(shift(today(), 15));
});

test('filters by search, assignee, and status', async ({ page }) => {
  await page.goto(`https://linear.app${MOBILE}`);
  const frame = await openGantt(page);
  await filterBy(frame, 'assignee', 'Sam Ortiz');
  await expect(frame.locator('.row.issue .identifier')).toHaveText(['MOB-4', 'MOB-2']);
  await filterBy(frame, 'status', 'In Progress');
  await expect(frame.locator('.row.issue .identifier')).toHaveText(['MOB-4']);
  await filterBy(frame, 'assignee', 'Unassigned');
  await expect(frame.locator('.empty')).toHaveText('No issues match these filters.');
  await filterBy(frame, 'assignee');
  await filterBy(frame, 'status');
  await frame.locator('#search').fill('mob-6');
  await expect(frame.locator('.row.issue .identifier')).toHaveText(['MOB-6']);
  await expect(frame.locator('#count')).toHaveText('1 of 6 issues');
});

test('shows issues that match any of the picked assignees or statuses', async ({ page }) => {
  await page.goto(`https://linear.app${MOBILE}`);
  const frame = await openGantt(page);
  await filterBy(frame, 'assignee', 'Maya Chen', 'Sam Ortiz');
  await expect(frame.locator('.row.issue .identifier')).toHaveText(['MOB-1', 'MOB-6', 'MOB-4', 'MOB-2', 'MOB-5']);
  await expect(frame.locator('#count')).toHaveText('5 of 6 issues');

  await filterBy(frame, 'assignee');
  await filterBy(frame, 'status', 'Todo', 'Done');
  await expect(frame.locator('.row.issue .identifier')).toHaveText(['MOB-6', 'MOB-2', 'MOB-3', 'MOB-5']);
  await expect(frame.locator('.row.section .label')).toHaveText(['Milestones2', 'Scheduled2', 'Unscheduled1', 'Completed1']);

  await filterBy(frame, 'assignee', 'Sam Ortiz', 'Unassigned');
  await expect(frame.locator('.row.issue .identifier')).toHaveText(['MOB-2', 'MOB-3']);
  await expect(frame.locator('#count')).toHaveText('2 of 6 issues');
});

test('combines picked assignees with the search', async ({ page }) => {
  await page.goto(`https://linear.app${MOBILE}`);
  const frame = await openGantt(page);
  await frame.locator('#search').fill('in');
  await expect(frame.locator('.row.issue .identifier')).toHaveText(['MOB-1', 'MOB-6', 'MOB-3']);
  await filterBy(frame, 'assignee', 'Maya Chen', 'Sam Ortiz');
  await expect(frame.locator('.row.issue .identifier')).toHaveText(['MOB-1', 'MOB-6']);
  await expect(frame.locator('#count')).toHaveText('2 of 6 issues');
});

test('names the picked filters on their buttons and keeps the menu open while picking', async ({ page }) => {
  await page.goto(`https://linear.app${MOBILE}`);
  const frame = await openGantt(page);
  const menu = frame.locator('#assignee-menu');
  await expect(frame.locator('#assignee')).toHaveText('All assignees');
  await expect(frame.locator('#status')).toHaveText('All statuses');

  await frame.locator('#assignee').click();
  await expect(menu.getByRole('checkbox')).toHaveCount(3);
  await expect(menu.locator('label')).toHaveText(['Maya Chen', 'Sam Ortiz', 'Unassigned']);
  await menu.getByLabel('Sam Ortiz').check();
  await expect(frame.locator('#assignee')).toHaveText('Sam Ortiz');
  await menu.getByLabel('Unassigned').check();
  await expect(frame.locator('#assignee')).toHaveText('2 assignees');
  await menu.getByLabel('Maya Chen').check();
  await expect(frame.locator('#assignee')).toHaveText('3 assignees');
  await expect(menu).toBeVisible();
  await menu.getByLabel('Unassigned').uncheck();
  await expect(frame.locator('#assignee')).toHaveText('2 assignees');
  await menu.getByRole('button', { name: 'Clear' }).click();
  await expect(frame.locator('#assignee')).toHaveText('All assignees');
  await expect(menu.getByRole('checkbox', { checked: true })).toHaveCount(0);
  await expect(frame.locator('.row.issue')).toHaveCount(6);

  await frame.locator('#count').click();
  await expect(menu).toBeHidden();
  await frame.locator('#assignee').click();
  await expect(menu).toBeVisible();
  await page.locator('aside').click({ position: { x: 10, y: 400 } });
  await expect(menu).toBeHidden();
  await frame.locator('#status').click();
  await expect(frame.locator('#status-menu label')).toHaveText(['Todo', 'In Progress', 'Done']);
  await frame.locator('#status-menu').getByLabel('Done').check();
  await expect(frame.locator('#status')).toHaveText('Done');
  await frame.locator('#status-menu').getByLabel('Todo').check();
  await expect(frame.locator('#status')).toHaveText('2 statuses');
});

test('the filter menus work from the keyboard and Escape closes them without leaving the chart', async ({ page }) => {
  await page.goto(`https://linear.app${MOBILE}`);
  const frame = await openGantt(page);
  const button = frame.locator('#assignee');
  const menu = frame.locator('#assignee-menu');
  await frame.locator('#search').focus();
  await page.keyboard.press('Tab');
  await expect(button).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(menu).toBeVisible();
  await page.keyboard.press('Tab');
  await expect(menu.getByLabel('Maya Chen')).toBeFocused();
  await page.keyboard.press('Space');
  await page.keyboard.press('Tab');
  await page.keyboard.press('Space');
  await expect(button).toHaveText('2 assignees');
  await expect(frame.locator('.row.issue .identifier')).toHaveText(['MOB-1', 'MOB-6', 'MOB-4', 'MOB-2', 'MOB-5']);

  await page.keyboard.press('Escape');
  await expect(menu).toBeHidden();
  await expect(button).toBeFocused();
  await page.keyboard.press('Space');
  await expect(menu).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(menu).toBeHidden();
  await expect(button).toBeFocused();
  await expect(ganttTab(page)).not.toBeFocused();
  await expect(button).toHaveText('2 assignees');
});

test('groups completed issues under Completed whether or not they have a due date', async ({ page, linear }) => {
  linear.issue('MOB-3').state = linear.issue('MOB-5').state;
  await page.goto(`https://linear.app${MOBILE}`);
  const frame = await openGantt(page);
  await expect(frame.locator('.row.section .label')).toHaveText(['Milestones2', 'Scheduled4', 'Completed2']);
  await expect(frame.locator('.row.issue .identifier')).toHaveText(['MOB-1', 'MOB-6', 'MOB-4', 'MOB-2', 'MOB-5', 'MOB-3']);
});

test('flags in-progress issues without a due date at the top until one is set', async ({ page, linear }) => {
  linear.issue('MOB-4').dueDate = null;
  await page.goto(`https://linear.app${MOBILE}`);
  const frame = await openGantt(page);
  await expect(frame.locator('.row.section .label')).toHaveText(['In progress, no due date1', 'Milestones2', 'Scheduled3', 'Unscheduled1', 'Completed1']);
  await expect(frame.locator('.row.section.warning .section-toggle')).toHaveCSS('color', 'rgb(242, 130, 138)');
  await expect(frame.locator('.row.issue .identifier').first()).toHaveText('MOB-4');
  await expect(frame.locator('.row.issue.warning .identifier')).toHaveText(['MOB-4']);
  await expect(row(frame, 'MOB-4').locator('.no-due')).toHaveText('No due date');
  await expect(row(frame, 'MOB-4').locator('.no-due')).toHaveCSS('color', 'rgb(242, 130, 138)');

  const target = shift(today(), 20);
  await row(frame, 'MOB-4').locator('.due-input').fill(target);
  await row(frame, 'MOB-4').locator('.due-input').press('Enter');
  await expect(row(frame, 'MOB-4').locator('.save-state')).toHaveText('Saved');
  expect(linear.issue('MOB-4').dueDate).toBe(target);
  await expect(frame.locator('.row.section .label')).toHaveText(['Milestones2', 'Scheduled4', 'Unscheduled1', 'Completed1']);
  await expect(row(frame, 'MOB-4')).not.toHaveClass(/warning/);
  await expect(row(frame, 'MOB-4').locator('.bar')).toHaveCount(1);
});

test('hides and shows a group from its header', async ({ page }) => {
  await page.goto(`https://linear.app${MOBILE}`);
  const frame = await openGantt(page);
  const scheduled = frame.locator('.section-toggle', { hasText: /^Scheduled/ });
  await expect(scheduled).toHaveAttribute('aria-expanded', 'true');
  await scheduled.click();
  await expect(scheduled).toHaveAttribute('aria-expanded', 'false');
  await expect(frame.locator('.row.section .label')).toHaveText(['Milestones2', 'Scheduled4', 'Unscheduled1', 'Completed1']);
  await expect(frame.locator('.row.issue .identifier')).toHaveText(['MOB-3', 'MOB-5']);

  await scheduled.focus();
  await page.keyboard.press('Enter');
  await expect(scheduled).toHaveAttribute('aria-expanded', 'true');
  await expect(scheduled).toBeFocused();
  await expect(frame.locator('.row.issue')).toHaveCount(6);

  await frame.locator('.section-toggle', { hasText: 'Milestones' }).click();
  await expect(frame.locator('.row.milestone-row')).toHaveCount(0);
});

test('keeps groups hidden across scale changes, filters, and refresh', async ({ page, linear }) => {
  await page.goto(`https://linear.app${MOBILE}`);
  const frame = await openGantt(page);
  const hidden = frame.locator('.section-toggle[aria-expanded="false"]');
  await frame.locator('.section-toggle', { hasText: 'Milestones' }).click();
  await frame.locator('.section-toggle', { hasText: 'Completed' }).click();
  await expect(hidden).toHaveText(['Milestones2', 'Completed1']);

  await frame.locator('[data-scale="month"]').click();
  await filterBy(frame, 'assignee', 'Maya Chen');
  await expect(frame.locator('.row.section .label')).toHaveText(['Milestones2', 'Scheduled2', 'Completed1']);
  await expect(hidden).toHaveText(['Milestones2', 'Completed1']);
  await expect(frame.locator('.row.milestone-row')).toHaveCount(0);
  await expect(frame.locator('.row.issue .identifier')).toHaveText(['MOB-1', 'MOB-6']);

  await frame.locator('#refresh').click();
  await expect.poll(() => linear.operations('GanttProjectIssues').length).toBe(2);
  await expect(frame.locator('#refresh')).toBeEnabled();
  await expect(hidden).toHaveText(['Milestones2', 'Completed1']);
  await expect(frame.locator('.row.issue .identifier')).toHaveText(['MOB-1', 'MOB-6']);
});

test('remembers collapsed groups and the scale across reloads and projects', async ({ page, worker }) => {
  await page.goto(`https://linear.app${MOBILE}`);
  let frame = await openGantt(page);
  await frame.locator('.section-toggle', { hasText: /^Scheduled/ }).click();
  await frame.locator('[data-scale="month"]').click();
  await expect.poll(() => stored(worker, 'view')).toEqual({ scale: 'month', collapsed: ['Scheduled'], groupBy: 'none' });

  await page.reload();
  frame = await openGantt(page);
  await expect(frame.locator('.section-toggle[aria-expanded="false"]')).toHaveText(['Scheduled4']);
  await expect(frame.locator('.row.issue .identifier')).toHaveText(['MOB-3', 'MOB-5']);
  await expect(frame.locator('[data-scale="month"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(frame.locator('[data-scale="week"]')).toHaveAttribute('aria-pressed', 'false');
  await expect(frame.locator('.units span').first()).toHaveText(/^[A-Z]/);

  await page.goto(`https://linear.app${WEBSITE}`);
  frame = await openGantt(page);
  await expect(frame.locator('.section-toggle[aria-expanded="false"]')).toHaveText(['Scheduled1']);
  await expect(frame.locator('.row.issue')).toHaveCount(0);
  await expect(frame.locator('[data-scale="month"]')).toHaveAttribute('aria-pressed', 'true');
});

test('remembers search and filters for each project', async ({ page, worker }) => {
  await page.goto(`https://linear.app${MOBILE}`);
  let frame = await openGantt(page);
  await frame.locator('#search').fill('ship');
  await filterBy(frame, 'assignee', 'Maya Chen', 'Sam Ortiz');
  await filterBy(frame, 'status', 'Todo', 'In Progress');
  await expect.poll(() => stored(worker, 'filters:project-mobile')).toEqual({ search: 'ship', assignee: ['user-maya', 'user-sam'], status: ['Todo', 'In Progress'] });

  await page.reload();
  frame = await openGantt(page);
  await expect(frame.locator('.row.issue .identifier')).toHaveText(['MOB-4']);
  await expect(frame.locator('#search')).toHaveValue('ship');
  await expect(frame.locator('#assignee')).toHaveText('2 assignees');
  await expect(frame.locator('#assignee-menu label:has(:checked)')).toHaveText(['Maya Chen', 'Sam Ortiz']);
  await expect(frame.locator('#status')).toHaveText('2 statuses');
  await expect(frame.locator('#status-menu label:has(:checked)')).toHaveText(['Todo', 'In Progress']);
  await frame.locator('#search').fill('');
  await expect(frame.locator('.row.issue .identifier')).toHaveText(['MOB-1', 'MOB-6', 'MOB-4', 'MOB-2']);

  await page.goto(`https://linear.app${WEBSITE}`);
  frame = await openGantt(page);
  await expect(frame.locator('.row.issue .identifier')).toHaveText(['WEB-1']);
  await expect(frame.locator('#search')).toHaveValue('');
  await expect(frame.locator('#assignee')).toHaveText('All assignees');
  await expect(frame.locator('#status')).toHaveText('All statuses');
});

test('reads filters saved as single values by earlier versions', async ({ page, worker }) => {
  await worker.evaluate(() => chrome.storage.local.set({ 'filters:project-mobile': { search: '', assignee: 'user-sam', status: '' } }));
  await page.goto(`https://linear.app${MOBILE}`);
  const frame = await openGantt(page);
  await expect(frame.locator('.row.issue .identifier')).toHaveText(['MOB-4', 'MOB-2']);
  await expect(frame.locator('#assignee')).toHaveText('Sam Ortiz');
  await expect(frame.locator('#status')).toHaveText('All statuses');
});

test('drops saved filter options that no longer exist, falling back to all', async ({ page, linear, worker }) => {
  await page.goto(`https://linear.app${MOBILE}`);
  let frame = await openGantt(page);
  await filterBy(frame, 'assignee', 'Maya Chen', 'Sam Ortiz');
  await filterBy(frame, 'status', 'In Progress');
  await expect.poll(() => stored(worker, 'filters:project-mobile')).toEqual({ search: '', assignee: ['user-maya', 'user-sam'], status: ['In Progress'] });

  for (const issue of linear.issues) if (issue.assignee?.id === 'user-sam') issue.assignee = null;
  await page.reload();
  frame = await openGantt(page);
  await expect(frame.locator('.row.issue .identifier')).toHaveText(['MOB-1']);
  await expect(frame.locator('#assignee')).toHaveText('Maya Chen');
  await expect(frame.locator('#status')).toHaveText('In Progress');

  for (const issue of linear.issues) if (issue.assignee?.id === 'user-maya') issue.assignee = null;
  await page.reload();
  frame = await openGantt(page);
  await expect(frame.locator('.row.issue .identifier')).toHaveText(['MOB-1', 'MOB-4']);
  await expect(frame.locator('#assignee')).toHaveText('All assignees');
  await expect(frame.locator('#status')).toHaveText('In Progress');
});

test('switches scales and returns to today', async ({ page }) => {
  await page.goto(`https://linear.app${MOBILE}`);
  const frame = await openGantt(page);
  for (const scale of ['day', 'week', 'month']) {
    await frame.locator(`[data-scale="${scale}"]`).click();
    const line = await frame.locator('.today-line').boundingBox();
    const chart = await frame.locator('#chart').boundingBox();
    await frame.locator('#chart').evaluate(element => { element.scrollLeft = 0; });
    await frame.locator('#today').click();
    const centered = await frame.locator('.today-line').boundingBox();
    const middle = chart.x + 400 + (chart.width - 400) / 2;
    expect(Math.abs(centered.x - middle)).toBeLessThan(40);
    expect(line).not.toBeNull();
  }
});

test('handles empty projects', async ({ page, linear }) => {
  linear.issues = linear.issues.filter(issue => issue.project.id !== 'project-website');
  await page.goto('https://linear.app/acme/project/website-a1b2c3d4e5f6/overview');
  const frame = await openGantt(page);
  await expect(frame.locator('.empty')).toHaveText('This project has no issues yet.');
});

test('loads and renders a project with 1,000 issues', async ({ page, linear }) => {
  linear.issues = linear.issues.filter(issue => issue.project.id !== 'project-website');
  linear.addIssues('project-website', 1000);
  await page.goto('https://linear.app/acme/project/website-a1b2c3d4e5f6/overview');
  const frame = await openGantt(page);
  await expect(frame.locator('#count')).toHaveText('1000 issues');
  await expect(frame.locator('.row.issue')).toHaveCount(1000);
  expect(linear.operations('GanttProjectIssues')).toHaveLength(10);
  await frame.locator('#search').fill('Generated issue 999');
  await expect(frame.locator('.row.issue')).toHaveCount(1);
});

for (const timezoneId of ['Pacific/Kiritimati', 'Pacific/Pago_Pago']) {
  test.describe(`in ${timezoneId}`, () => {
    test.use({ timezoneId });

    test('due dates are saved and shown exactly as picked', async ({ page, linear }) => {
      linear.issue('MOB-2').dueDate = '2030-01-01';
      await page.goto(`https://linear.app${MOBILE}`);
      const frame = await openGantt(page);
      await expect(row(frame, 'MOB-2').locator('.due-input')).toHaveValue('2030-01-01');
      await expect(row(frame, 'MOB-2').locator('.marker')).toHaveAttribute('title', /Due: Jan 1, 2030/);
      await row(frame, 'MOB-3').locator('.due-input').fill('2030-12-31');
      await row(frame, 'MOB-3').locator('.due-input').press('Enter');
      await expect(row(frame, 'MOB-3').locator('.save-state')).toHaveText('Saved');
      expect(linear.issue('MOB-3').dueDate).toBe('2030-12-31');
      await expect(row(frame, 'MOB-3').locator('.marker')).toHaveAttribute('title', /Due: Dec 31, 2030/);
    });
  });
}
