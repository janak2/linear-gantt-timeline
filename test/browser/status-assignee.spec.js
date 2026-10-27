import { MOBILE, expect, openGantt, row, test } from './harness.js';

const sections = frame => frame.locator('.row.section .label');
const status = (frame, identifier) => row(frame, identifier).getByLabel(`Status for ${identifier}`);
const assignee = (frame, identifier) => row(frame, identifier).getByLabel(`Assignee for ${identifier}`);

// The full list of choices is added when the select is focused.
async function pick(select, label) {
  await select.focus();
  await select.selectOption({ label });
}

test.beforeEach(async ({ signIn }) => signIn());

test('changes the status and moves the issue to Completed', async ({ page, linear }) => {
  await page.goto(`https://linear.app${MOBILE}`);
  const frame = await openGantt(page);
  await expect(status(frame, 'MOB-2')).toHaveValue('todo');
  await expect(sections(frame)).toHaveText(['Milestones2', 'Scheduled4', 'Unscheduled1', 'Completed1']);

  await pick(status(frame, 'MOB-2'), 'Done');
  await expect(row(frame, 'MOB-2').locator('.save-state')).toHaveText('Saved');
  expect(linear.operations('GanttUpdateStatus').map(call => call.variables)).toEqual([{ id: 'project-mobile-issue-2', stateId: 'done' }]);
  expect(linear.issue('MOB-2').state.id).toBe('done');
  await expect(sections(frame)).toHaveText(['Milestones2', 'Scheduled3', 'Unscheduled1', 'Completed2']);
  await expect(frame.locator('.row.issue .identifier')).toHaveText(['MOB-1', 'MOB-6', 'MOB-4', 'MOB-3', 'MOB-5', 'MOB-2']);
  await expect(status(frame, 'MOB-2')).toHaveValue('done');
  await expect(row(frame, 'MOB-2').locator('.dot')).toHaveAttribute('data-type', 'completed');
});

test("offers the statuses and members of each issue's own team", async ({ page, linear }) => {
  Object.assign(linear.issue('MOB-6'), { team: { id: 'team-web' }, state: { id: 'web-todo', name: 'Todo', type: 'unstarted', color: '#9ea0aa' } });
  await page.goto(`https://linear.app${MOBILE}`);
  const frame = await openGantt(page);
  await status(frame, 'MOB-2').focus();
  await expect(status(frame, 'MOB-2').locator('option')).toHaveText(['Backlog', 'Todo', 'In Progress', 'In Review', 'Done', 'Canceled']);
  expect(linear.operations('GanttTeam').map(call => call.variables.id).sort()).toEqual(['team-mob', 'team-web']);
  await assignee(frame, 'MOB-2').focus();
  await expect(assignee(frame, 'MOB-2').locator('option')).toHaveText(['Unassigned', 'Maya Chen', 'Priya Nair', 'Sam Ortiz']);

  await status(frame, 'MOB-6').focus();
  await expect(status(frame, 'MOB-6').locator('option')).toHaveText(['Todo', 'Building', 'Shipped']);
  // Maya is assigned but not a member of the Web team, so she stays listed.
  await assignee(frame, 'MOB-6').focus();
  await expect(assignee(frame, 'MOB-6').locator('option')).toHaveText(['Unassigned', 'Leo Brandt', 'Maya Chen', 'Sam Ortiz']);
  await expect(assignee(frame, 'MOB-6')).toHaveValue('user-maya');

  await pick(status(frame, 'MOB-6'), 'Shipped');
  await expect(row(frame, 'MOB-6').locator('.save-state')).toHaveText('Saved');
  expect(linear.operations('GanttUpdateStatus')[0].variables).toEqual({ id: 'project-mobile-issue-6', stateId: 'web-done' });
});

test('changes and clears the assignee', async ({ page, linear }) => {
  await page.goto(`https://linear.app${MOBILE}`);
  const frame = await openGantt(page);
  await expect(assignee(frame, 'MOB-3').locator('option:checked')).toHaveText('Unassigned');

  await pick(assignee(frame, 'MOB-3'), 'Priya Nair');
  await expect(row(frame, 'MOB-3').locator('.save-state')).toHaveText('Saved');
  expect(linear.issue('MOB-3').assignee).toEqual({ id: 'user-priya', name: 'Priya Nair' });
  await expect(assignee(frame, 'MOB-3')).toHaveValue('user-priya');
  await expect(assignee(frame, 'MOB-3').locator('option:checked')).toHaveText('Priya Nair');

  await pick(assignee(frame, 'MOB-2'), 'Unassigned');
  await expect(row(frame, 'MOB-2').locator('.save-state')).toHaveText('Saved');
  expect(linear.issue('MOB-2').assignee).toBe(null);
  await expect(assignee(frame, 'MOB-2').locator('option:checked')).toHaveText('Unassigned');
  expect(linear.operations('GanttUpdateAssignee').map(call => call.variables)).toEqual([
    { id: 'project-mobile-issue-3', assigneeId: 'user-priya' },
    { id: 'project-mobile-issue-2', assigneeId: null }
  ]);
});

test('shows an error and restores the previous value when a save fails', async ({ page, linear }) => {
  await page.goto(`https://linear.app${MOBILE}`);
  const frame = await openGantt(page);
  linear.respondOnce('GanttUpdateStatus', { status: 500, body: {} });
  await pick(status(frame, 'MOB-2'), 'Done');
  await expect(row(frame, 'MOB-2').locator('.save-state')).toHaveText('Not saved');
  await expect(frame.locator('#notice')).toHaveText('MOB-2: Linear request failed (HTTP 500). Try again.');
  await expect(status(frame, 'MOB-2')).toHaveValue('todo');
  await expect(sections(frame)).toHaveText(['Milestones2', 'Scheduled4', 'Unscheduled1', 'Completed1']);
  expect(linear.issue('MOB-2').state.id).toBe('todo');

  linear.respondOnce('GanttUpdateAssignee', { status: 400, body: { errors: [{ extensions: { code: 'FORBIDDEN', userPresentableMessage: 'You cannot edit issues in this team.' } }] } });
  await pick(assignee(frame, 'MOB-4'), 'Maya Chen');
  await expect(frame.locator('#notice')).toHaveText('MOB-4: You cannot edit issues in this team.');
  await expect(row(frame, 'MOB-4').locator('.save-state')).toHaveText('Not saved');
  await expect(assignee(frame, 'MOB-4')).toHaveValue('user-sam');
  expect(linear.issue('MOB-4').assignee.id).toBe('user-sam');
});

test('does not overwrite a status or assignee someone else changed', async ({ page, linear }) => {
  await page.goto(`https://linear.app${MOBILE}`);
  const frame = await openGantt(page);
  await expect(status(frame, 'MOB-2')).toHaveValue('todo');
  linear.issue('MOB-2').state = linear.issue('MOB-1').state;
  linear.issue('MOB-3').assignee = linear.issue('MOB-1').assignee;

  await pick(status(frame, 'MOB-2'), 'Done');
  await expect(frame.locator('#notice')).toHaveText('MOB-2: Someone else changed this status in Linear to In Progress. Your change was not saved.');
  await expect(status(frame, 'MOB-2')).toHaveValue('started');

  await pick(assignee(frame, 'MOB-3'), 'Sam Ortiz');
  await expect(frame.locator('#notice')).toHaveText('MOB-3: Someone else changed this assignee in Linear to Maya Chen. Your change was not saved.');
  await expect(assignee(frame, 'MOB-3')).toHaveValue('user-maya');
  expect(linear.operations('GanttUpdateStatus')).toHaveLength(0);
  expect(linear.operations('GanttUpdateAssignee')).toHaveLength(0);
});
