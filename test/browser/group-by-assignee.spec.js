import { MOBILE, expect, openGantt, row, test } from './harness.js';

const stored = (worker, key) => worker.evaluate(async key => (await chrome.storage.local.get(key))[key], key);
const outline = frame => frame.locator('.row.section .label, .row.subsection .label, .row.milestone-row .title, .row.issue .identifier');
const groups = frame => frame.locator('.row.subsection .section-toggle');

async function groupByAssignee(page) {
  await page.goto(`https://linear.app${MOBILE}`);
  const frame = await openGantt(page);
  await frame.locator('#group-by').selectOption('assignee');
  await expect(groups(frame).first()).toBeVisible();
  return frame;
}

test.beforeEach(async ({ signIn }) => signIn());

test('groups issues by assignee inside each issue section, with Unassigned last', async ({ page, linear }) => {
  linear.issue('MOB-4').dueDate = null;
  linear.issue('MOB-6').assignee = null;
  const frame = await groupByAssignee(page);
  await expect(outline(frame)).toHaveText([
    'Milestones2', 'Beta', 'Launch',
    'Issues6', 'Maya Chen2', 'MOB-1', 'MOB-5', 'Sam Ortiz2', 'MOB-4', 'MOB-2', 'Unassigned2', 'MOB-6', 'MOB-3'
  ]);
  await expect(row(frame, 'MOB-4')).toHaveClass(/warning/);
  await expect(frame.locator('#count')).toHaveText('6 issues');
});

test('keeps rows in schedule order within an assignee group', async ({ page }) => {
  const frame = await groupByAssignee(page);
  await expect(outline(frame)).toHaveText([
    'Milestones2', 'Beta', 'Launch',
    'Issues6', 'Maya Chen3', 'MOB-1', 'MOB-6', 'MOB-5', 'Sam Ortiz2', 'MOB-4', 'MOB-2', 'Unassigned1', 'MOB-3'
  ]);
});

test('collapses an assignee group in one section only and remembers it and the grouping', async ({ page, worker }) => {
  let frame = await groupByAssignee(page);
  const maya = () => groups(frame).filter({ hasText: 'Maya Chen' });
  await maya().nth(0).click();
  await expect(maya().nth(0)).toHaveAttribute('aria-expanded', 'false');
  await expect(frame.locator('.row.issue .identifier')).toHaveText(['MOB-4', 'MOB-2', 'MOB-3']);
  await expect(maya().nth(0)).toBeFocused();
  await expect.poll(() => stored(worker, 'view')).toEqual({ scale: 'week', collapsed: ['Issues/user-maya'], groupBy: 'assignee', sort: 'default', descending: false });

  await page.reload();
  frame = await openGantt(page);
  await expect(frame.locator('#group-by')).toHaveValue('assignee');
  await expect(frame.locator('.section-toggle[aria-expanded="false"]')).toHaveText(['Maya Chen3']);
  await expect(frame.locator('.row.issue .identifier')).toHaveText(['MOB-4', 'MOB-2', 'MOB-3']);

  await maya().nth(0).click();
  await expect(frame.locator('.row.issue .identifier')).toHaveText(['MOB-1', 'MOB-6', 'MOB-5', 'MOB-4', 'MOB-2', 'MOB-3']);
  await expect.poll(() => stored(worker, 'view')).toEqual({ scale: 'week', collapsed: [], groupBy: 'assignee', sort: 'default', descending: false });
});

test('moves an issue to its new assignee group after reassigning it', async ({ page }) => {
  const frame = await groupByAssignee(page);
  const assignee = identifier => row(frame, identifier).getByLabel(`Assignee for ${identifier}`);

  await assignee('MOB-2').focus();
  await assignee('MOB-2').selectOption({ label: 'Maya Chen' });
  await expect(row(frame, 'MOB-2').locator('.save-state')).toHaveText('Saved');
  await expect(outline(frame)).toHaveText([
    'Milestones2', 'Beta', 'Launch',
    'Issues6', 'Maya Chen4', 'MOB-1', 'MOB-6', 'MOB-2', 'MOB-5', 'Sam Ortiz1', 'MOB-4', 'Unassigned1', 'MOB-3'
  ]);

  await assignee('MOB-4').focus();
  await assignee('MOB-4').selectOption({ label: 'Unassigned' });
  await expect(row(frame, 'MOB-4').locator('.save-state')).toHaveText('Saved');
  await expect(outline(frame)).toHaveText([
    'Milestones2', 'Beta', 'Launch',
    'Issues6', 'Maya Chen4', 'MOB-1', 'MOB-6', 'MOB-2', 'MOB-5', 'Unassigned2', 'MOB-4', 'MOB-3'
  ]);
});
