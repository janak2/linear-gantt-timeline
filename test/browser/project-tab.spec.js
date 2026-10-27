import { MOBILE, WEBSITE, expect, ganttTab, openGantt, panelFrames, panelHost, row, test } from './harness.js';

test.beforeEach(async ({ signIn }) => signIn());

test('adds one Gantt tab beside the project tabs and shows the chart in the content area', async ({ page, linear }) => {
  await page.goto(`https://linear.app${MOBILE}`);
  await expect(ganttTab(page)).toHaveCount(1);
  await expect(page.locator('header .tabs > *')).toHaveText(['Overview', 'Issues', 'Gantt']);

  const frame = await openGantt(page);
  await expect(row(frame, 'MOB-1')).toBeVisible();
  await expect(frame.locator('.row.issue')).toHaveCount(6);
  await expect(frame.locator('.row.section .label')).toHaveText(['Milestones2', 'Scheduled4', 'Unscheduled1', 'Completed1']);
  await expect(ganttTab(page)).toHaveAttribute('aria-pressed', 'true');

  // The chart covers the content area only: Linear's sidebar and header stay visible.
  const box = await panelHost(page).boundingBox();
  expect(box).toEqual({ x: 240, y: 49, width: 1400 - 240, height: 900 - 49 });
  expect(linear.operations('GanttProject')[0].variables.slugIds).toEqual(['mobile-app-3f2a1b9c8d7e', '3f2a1b9c8d7e']);
});

test('loads the chart before the tab is clicked without blocking the page', async ({ page, linear }) => {
  await page.goto(`https://linear.app${MOBILE}`);
  await expect.poll(() => linear.operations('GanttProjectIssues').length).toBe(1);
  await expect.poll(() => panelFrames(page).length).toBe(1);
  const frame = panelFrames(page)[0];
  await expect(frame.locator('.row.issue')).toHaveCount(6);
  await expect(panelHost(page)).toBeHidden();
  await expect(ganttTab(page)).toHaveAttribute('aria-pressed', 'false');

  // The hidden chart over the content area takes neither keyboard focus nor clicks.
  const seeAll = page.locator('main a', { hasText: 'See all' });
  await seeAll.focus();
  await page.keyboard.press('Tab');
  expect(await page.evaluate(() => document.activeElement.getAttribute('data-linear-gantt'))).toBeNull();
  await seeAll.click();
  await expect(page).toHaveURL(/\/activity$/);

  await ganttTab(page).click();
  await expect(panelHost(page)).toBeVisible();
  await expect(row(frame, 'MOB-1')).toBeVisible();
  expect(linear.operations('GanttProjectIssues')).toHaveLength(1);
  const line = await frame.locator('.today-line').boundingBox();
  const chart = await frame.locator('#chart').boundingBox();
  expect(Math.abs(line.x - (chart.x + 400 + (chart.width - 400) / 2))).toBeLessThan(40);
});

test('links issues back to Linear', async ({ page }) => {
  await page.goto(`https://linear.app${MOBILE}`);
  const frame = await openGantt(page);
  await expect(row(frame, 'MOB-2').locator('a.title')).toHaveAttribute('href', 'https://linear.app/acme/issue/MOB-2');
  await expect(row(frame, 'MOB-2').locator('a.title')).toHaveAttribute('target', '_top');
});

test('going back from an issue returns to the chart', async ({ page }) => {
  await page.goto(`https://linear.app${MOBILE}`);
  const frame = await openGantt(page);
  await row(frame, 'MOB-2').locator('a.title').click();
  await expect(page).toHaveURL('https://linear.app/acme/issue/MOB-2');
  await page.goBack();
  await expect(page).toHaveURL(`https://linear.app${MOBILE}`);
  await expect(panelHost(page)).toBeVisible();
  await expect(ganttTab(page)).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(() => panelFrames(page).length).toBe(1);
  await expect(row(panelFrames(page)[0], 'MOB-2')).toBeVisible();

  // A chart closed before leaving stays closed.
  await page.locator('header .tabs a', { hasText: 'Overview' }).click();
  await expect(panelHost(page)).toBeHidden();
  await page.goto('https://linear.app/acme/issue/MOB-2');
  await page.goBack();
  await expect(page).toHaveURL(`https://linear.app${MOBILE}`);
  await expect(ganttTab(page)).toHaveCount(1);
  await expect(panelHost(page)).toHaveCount(1);
  await expect(panelHost(page)).toBeHidden();
  await expect(ganttTab(page)).toHaveAttribute('aria-pressed', 'false');
});

test('reloading the page reopens the chart', async ({ page }) => {
  await page.goto(`https://linear.app${MOBILE}`);
  await openGantt(page);
  await page.reload();
  await expect(panelHost(page)).toBeVisible();
  await expect(ganttTab(page)).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(() => panelFrames(page).length).toBe(1);
  await expect(row(panelFrames(page)[0], 'MOB-2')).toBeVisible();

  // A chart closed before reloading stays closed.
  await page.locator('header .tabs a', { hasText: 'Overview' }).click();
  await expect(panelHost(page)).toBeHidden();
  await page.reload();
  await expect(ganttTab(page)).toHaveCount(1);
  await expect(panelHost(page)).toHaveCount(1);
  await expect(panelHost(page)).toBeHidden();
  await expect(ganttTab(page)).toHaveAttribute('aria-pressed', 'false');
});

test('labels actual start dates and never invents them', async ({ page }) => {
  await page.goto(`https://linear.app${MOBILE}`);
  const frame = await openGantt(page);
  await expect(row(frame, 'MOB-1').locator('.start')).toHaveText(/^Started /);
  await expect(row(frame, 'MOB-1').locator('.bar')).toHaveAttribute('title', /Actual start: /);
  await expect(row(frame, 'MOB-2').locator('.start')).toHaveText('Not started');
  await expect(row(frame, 'MOB-2').locator('.marker')).toHaveCount(1);
  await expect(row(frame, 'MOB-2').locator('.bar')).toHaveCount(0);
  await expect(row(frame, 'MOB-3').locator('.track > *')).toHaveCount(0);
});

test('shows project milestones in order, with a marker at each target date', async ({ page }) => {
  await page.goto(`https://linear.app${MOBILE}`);
  const frame = await openGantt(page);
  const milestones = frame.locator('.row.milestone-row');
  await expect(milestones.locator('.title')).toHaveText(['Beta', 'Launch']);
  await expect(milestones.locator('.meta')).toHaveText([/^Target /, 'No target date']);
  await expect(milestones.nth(0).locator('.milestone')).toHaveCount(1);
  await expect(milestones.nth(1).locator('.milestone')).toHaveCount(0);
  await expect(frame.locator('.milestone-line')).toHaveCount(1);
});

test('names the milestone when hovering its line', async ({ page }) => {
  await page.goto(`https://linear.app${MOBILE}`);
  const frame = await openGantt(page);
  const line = frame.locator('.milestone-line');
  await expect(line).toHaveAttribute('title', /^Beta\nTarget /);
  const hit = await line.evaluate(line => {
    const box = line.getBoundingClientRect();
    const empty = document.querySelector('.row.issue[data-issue="project-mobile-issue-3"]').getBoundingClientRect();
    return { width: box.width, hit: document.elementFromPoint(box.left + box.width / 2, empty.top + empty.height / 2) === line };
  });
  expect(hit).toEqual({ width: 7, hit: true });
});

test('keeps Linear navigation working and closes the chart when you leave', async ({ page }) => {
  await page.goto(`https://linear.app${MOBILE}`);
  await openGantt(page);
  await page.locator('header .tabs a', { hasText: 'Issues' }).click();
  await expect(page).toHaveURL(/\/issues$/);
  await expect(panelHost(page)).toBeHidden();
  await expect(ganttTab(page)).toHaveAttribute('aria-pressed', 'false');

  await openGantt(page);
  await page.locator('header .tabs a', { hasText: 'Issues' }).click();
  await expect(panelHost(page)).toBeHidden();

  await page.locator('#nav-inbox').click();
  await expect(page).toHaveURL(/\/acme\/inbox$/);
  await expect(ganttTab(page)).toHaveCount(0);
  await expect(panelHost(page)).toHaveCount(0);
});

test('switching projects removes the stale chart', async ({ page }) => {
  await page.goto(`https://linear.app${MOBILE}`);
  const mobile = await openGantt(page);
  await expect(row(mobile, 'MOB-1')).toBeVisible();

  await page.locator('#nav-website').click();
  await expect(page).toHaveURL(new RegExp(`${WEBSITE}$`));
  await expect(ganttTab(page)).toHaveCount(1);
  await expect(panelHost(page)).toHaveCount(1);
  await expect(panelHost(page)).toBeHidden();
  await expect.poll(() => panelFrames(page).map(frame => new URL(frame.url()).searchParams.get('slug'))).toEqual(['website-a1b2c3d4e5f6']);

  const website = await openGantt(page);
  expect(website.url()).toContain('slug=website-a1b2c3d4e5f6');
  await expect(row(website, 'WEB-1')).toBeVisible();
  await expect(website.locator('.row.issue')).toHaveCount(1);
});

test('shows an unavailable state when the project cannot be identified', async ({ page }) => {
  await page.goto('https://linear.app/acme/project/ghost-ffffffffffff/overview');
  const frame = await openGantt(page);
  await expect(frame.locator('#gate-title')).toHaveText('Project unavailable');
  await expect(frame.locator('.row.issue')).toHaveCount(0);
});

test('requires the connected workspace before loading issues', async ({ page, linear }) => {
  await page.goto(`https://linear.app${MOBILE}`);
  await openGantt(page);
  await page.locator('#nav-beta').click();
  const frame = await openGantt(page);
  expect(frame.url()).toContain('workspace=beta');
  await expect(frame.locator('#gate-title')).toHaveText('Different workspace');
  await expect(frame.locator('#gate-text')).toContainText('connected to Acme');
  expect(linear.operations('GanttProject').every(call => call.variables.slugIds.every(id => !id.includes('0a0b0c0d0e0f')))).toBe(true);
});

test('does not duplicate the tab after re-renders or reloads', async ({ page }) => {
  await page.goto(`https://linear.app${MOBILE}`);
  await expect(ganttTab(page)).toHaveCount(1);
  for (let i = 0; i < 5; i++) {
    await page.evaluate(() => window.rerender());
    await expect(ganttTab(page)).toHaveCount(1);
  }
  await expect(page.locator('header .tabs > *')).toHaveText(['Overview', 'Issues', 'Gantt']);
  await expect(panelHost(page)).toHaveCount(1);
  await expect.poll(() => panelFrames(page).length).toBe(1);

  await openGantt(page);
  await page.evaluate(() => window.rerender());
  await expect(ganttTab(page)).toHaveCount(1);
  expect(panelFrames(page)).toHaveLength(1);

  await page.reload();
  await expect(ganttTab(page)).toHaveCount(1);
  await expect(panelHost(page)).toHaveCount(1);
  await expect(panelHost(page)).toBeVisible();
  await openGantt(page);
  expect(panelFrames(page)).toHaveLength(1);
});

test('follows the Linear theme', async ({ page }) => {
  await page.goto(`https://linear.app${MOBILE}`);
  const frame = await openGantt(page);
  await expect(frame.locator('html')).toHaveAttribute('data-theme', 'dark');
  const overview = page.locator('header .tabs a', { hasText: 'Overview' });
  const gantt = ganttTab(page).locator('a');
  await expect(gantt).toHaveCSS('opacity', '1');
  await expect(gantt).toHaveCSS('font-weight', '600');
  await expect(overview).toHaveCSS('opacity', '0.65');

  await page.evaluate(() => window.setTheme('light'));
  await expect(frame.locator('html')).toHaveAttribute('data-theme', 'light');
  await expect(gantt).toHaveCSS('color', 'rgb(28, 28, 31)');
  await expect(gantt).toHaveCSS('opacity', '1');
  await expect(overview).toHaveCSS('opacity', '0.65');

  await page.evaluate(() => window.setTheme('dark'));
  await expect(frame.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect(gantt).toHaveCSS('color', 'rgb(230, 230, 234)');
});

test('can be used with the keyboard', async ({ page, linear }) => {
  await page.goto(`https://linear.app${MOBILE}`);
  await ganttTab(page).focus();
  await page.keyboard.press('Enter');
  await expect.poll(() => panelFrames(page).length).toBe(1);
  const frame = panelFrames(page)[0];
  await expect(row(frame, 'MOB-3')).toBeVisible();

  await page.keyboard.press('Tab');
  await expect(frame.locator('#search')).toBeFocused();
  await page.keyboard.type('docs');
  await expect(frame.locator('.row.issue')).toHaveCount(1);

  const input = row(frame, 'MOB-3').locator('.due-input');
  await input.focus();
  await page.keyboard.type('11202030');
  await page.keyboard.press('Enter');
  await expect(row(frame, 'MOB-3').locator('.save-state')).toHaveText('Saved');
  expect(linear.issue('MOB-3').dueDate).toBe('2030-11-20');

  await frame.locator('[data-scale="month"]').focus();
  await page.keyboard.press('Enter');
  await expect(frame.locator('[data-scale="month"]')).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press('Escape');
  await expect(ganttTab(page)).toBeFocused();
});
