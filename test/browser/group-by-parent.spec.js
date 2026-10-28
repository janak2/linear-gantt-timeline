import { MOBILE, expect, filterBy, openGantt, row, test } from './harness.js';

const identifiers = frame => frame.locator('.row.issue .identifier, .row.parent-row .identifier');
const stored = (worker, key) => worker.evaluate(async key => (await chrome.storage.local.get(key))[key], key);

test.beforeEach(async ({ signIn }) => signIn());

test('nests sub-issues under their parent, with a shared placeholder for a parent outside the group', async ({ page }) => {
  await page.goto(`https://linear.app${MOBILE}`);
  const frame = await openGantt(page);
  await frame.getByLabel('Group by').selectOption('Parent');
  await expect(frame.locator('#group-by')).toHaveValue('parent');
  await expect(identifiers(frame)).toHaveText(['MOB-1', 'MOB-4', 'WEB-1', 'MOB-6', 'MOB-2', 'MOB-1', 'MOB-3', 'MOB-5']);
  await expect(frame.locator('.row.section .label')).toHaveText(['Milestones2', 'Scheduled4', 'Unscheduled1', 'Completed1']);
  await expect(frame.locator('.row.subsection')).toHaveCount(0);
  await expect(row(frame, 'MOB-1').locator('.label')).toHaveCSS('padding-left', '16px');
  await expect(row(frame, 'MOB-4').locator('.label')).toHaveCSS('padding-left', '32px');
  await expect(row(frame, 'MOB-3').locator('.label')).toHaveCSS('padding-left', '32px');

  const placeholders = frame.locator('.row.parent-row');
  await expect(placeholders.locator('.identifier')).toHaveText(['WEB-1', 'MOB-1']);
  await expect(placeholders.locator('.title')).toHaveText(['Landing page', 'Build sync engine']);
  await expect(placeholders.nth(0).locator('a.title')).toHaveAttribute('href', 'https://linear.app/acme/issue/WEB-1');
  await expect(placeholders.nth(0).locator('a.title')).toHaveAttribute('target', '_top');
  await expect(placeholders.locator('.bar, .marker, .due-input, .clear')).toHaveCount(0);
});

test('nests deeper levels and uses a placeholder for a parent hidden by a filter', async ({ page, linear }) => {
  const { id, identifier, title, url } = linear.issue('MOB-4');
  linear.issue('MOB-2').parent = { id, identifier, title, url };
  await page.goto(`https://linear.app${MOBILE}`);
  const frame = await openGantt(page);
  await frame.locator('#group-by').selectOption('parent');
  await expect(identifiers(frame)).toHaveText(['MOB-1', 'MOB-4', 'MOB-2', 'WEB-1', 'MOB-6', 'MOB-1', 'MOB-3', 'MOB-5']);
  await expect(row(frame, 'MOB-2').locator('.label')).toHaveCSS('padding-left', '48px');

  await filterBy(frame, 'assignee', 'Sam Ortiz');
  await expect(identifiers(frame)).toHaveText(['MOB-1', 'MOB-4', 'MOB-2']);
  await expect(frame.locator('.row.parent-row .identifier')).toHaveText(['MOB-1']);
  await expect(frame.locator('.row.section .label')).toHaveText(['Milestones2', 'Scheduled2']);
});

test('remembers the setting across reloads and None restores the flat list', async ({ page, worker }) => {
  await page.goto(`https://linear.app${MOBILE}`);
  let frame = await openGantt(page);
  await frame.locator('#group-by').selectOption('parent');
  await expect.poll(() => stored(worker, 'view')).toEqual({ scale: 'week', collapsed: [], groupBy: 'parent' });

  await page.reload();
  frame = await openGantt(page);
  await expect(frame.locator('#group-by')).toHaveValue('parent');
  await expect(frame.locator('.row.parent-row')).toHaveCount(2);

  await frame.locator('#group-by').selectOption('none');
  await expect(frame.locator('.row.parent-row')).toHaveCount(0);
  await expect(identifiers(frame)).toHaveText(['MOB-1', 'MOB-6', 'MOB-4', 'MOB-2', 'MOB-3', 'MOB-5']);
  await expect(row(frame, 'MOB-4').locator('.label')).toHaveCSS('padding-left', '16px');
  await expect.poll(() => stored(worker, 'view')).toEqual({ scale: 'week', collapsed: [], groupBy: 'none' });
});

test('keeps an earlier "Group by parent" setting', async ({ page, worker }) => {
  await worker.evaluate(() => chrome.storage.local.set({ view: { scale: 'week', collapsed: [], byParent: true } }));
  await page.goto(`https://linear.app${MOBILE}`);
  const frame = await openGantt(page);
  await expect(frame.locator('#group-by')).toHaveValue('parent');
  await expect(frame.locator('.row.parent-row')).toHaveCount(2);
});
