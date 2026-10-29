import { MOBILE, WEBSITE, expect, ganttTab, panelFrames, panelHost, row, test } from './harness.js';

const GANTT = MOBILE.replace(/overview$/, 'gantt');
const notFound = page => page.evaluate(() => window.notFound);
const slugs = page => panelFrames(page).map(frame => new URL(frame.url()).searchParams.get('slug'));

for (const router of ['history', 'navigation']) {
  test.describe(`with a ${router} router`, () => {
    test.beforeEach(async ({ page, signIn }) => {
      await signIn();
      if (router === 'navigation') await page.addInitScript(() => { window.useNavigationAPI = true; });
    });

    test('opening the /gantt address shows the overview with the chart open', async ({ page }) => {
      await page.goto(`https://linear.app${GANTT}`);
      await expect(panelHost(page)).toBeVisible();
      await expect(ganttTab(page)).toHaveAttribute('aria-pressed', 'true');
      await expect(page).toHaveURL(`https://linear.app${GANTT}`);
      await expect(page.locator('main')).toHaveText(/^overview for mobile-app-3f2a1b9c8d7e/);
      await expect.poll(() => panelFrames(page).length).toBe(1);
      await expect(row(panelFrames(page)[0], 'MOB-1')).toBeVisible();
      expect(await notFound(page)).toBe(0);

      await page.reload();
      await expect(panelHost(page)).toBeVisible();
      await expect(page).toHaveURL(`https://linear.app${GANTT}`);
      await expect(page.locator('main')).toHaveText(/^overview for/);
      expect(await notFound(page)).toBe(0);
    });

    test('shows /gantt while the chart is open, and Back and Forward move between it and other tabs', async ({ page }) => {
      await page.goto(`https://linear.app${MOBILE}`);
      await ganttTab(page).click();
      await expect(panelHost(page)).toBeVisible();
      await expect(page).toHaveURL(`https://linear.app${GANTT}`);

      await page.locator('header .tabs a', { hasText: 'Issues' }).click();
      await expect(page).toHaveURL(/\/issues$/);
      await expect(panelHost(page)).toBeHidden();
      await expect(page.locator('main')).toHaveText(/^issues for/);

      await page.goBack();
      await expect(panelHost(page)).toBeVisible();
      await expect(page).toHaveURL(`https://linear.app${GANTT}`);
      await expect(page.locator('main')).toHaveText(/^overview for/);
      await expect(ganttTab(page)).toHaveAttribute('aria-pressed', 'true');

      await page.goForward();
      await expect(page).toHaveURL(/\/issues$/);
      await expect(panelHost(page)).toBeHidden();
      await page.goBack();
      await expect(panelHost(page)).toBeVisible();
      await expect(page).toHaveURL(`https://linear.app${GANTT}`);
      expect(await notFound(page)).toBe(0);
    });

    test("a project's /gantt address never opens another project's chart", async ({ page }) => {
      await page.goto(`https://linear.app${GANTT}`);
      await expect(panelHost(page)).toBeVisible();
      await page.locator('#nav-website').click();
      await expect(page).toHaveURL(`https://linear.app${WEBSITE}`);
      await expect.poll(() => slugs(page)).toEqual(['website-a1b2c3d4e5f6']);
      await expect(panelHost(page)).toBeHidden();
      await expect(ganttTab(page)).toHaveAttribute('aria-pressed', 'false');

      await page.goBack();
      await expect.poll(() => slugs(page)).toEqual(['mobile-app-3f2a1b9c8d7e']);
      await expect(panelHost(page)).toBeVisible();
      await expect(page).toHaveURL(`https://linear.app${GANTT}`);

      await page.goto(`https://linear.app${WEBSITE.replace(/overview$/, 'gantt')}`);
      await expect(panelHost(page)).toBeVisible();
      await expect.poll(() => slugs(page)).toEqual(['website-a1b2c3d4e5f6']);
      expect(await notFound(page)).toBe(0);
    });
  });
}

test.describe('the /gantt address', () => {
  test.beforeEach(async ({ signIn }) => signIn());

  test('goes back to the project address when the chart closes without Linear navigating', async ({ page }) => {
    await page.goto(`https://linear.app${GANTT}`);
    await expect(panelHost(page)).toBeVisible();
    await page.locator('header .tabs').dispatchEvent('click');
    await expect(panelHost(page)).toBeHidden();
    await expect(page).toHaveURL(`https://linear.app${MOBILE}`);
    expect(await notFound(page)).toBe(0);
  });

  test('keeps one tab and the chart open while Linear re-renders', async ({ page }) => {
    await page.goto(`https://linear.app${GANTT}`);
    await expect(panelHost(page)).toBeVisible();
    for (let i = 0; i < 3; i++) await page.evaluate(() => window.rerender());
    await expect(ganttTab(page)).toHaveCount(1);
    await expect(panelHost(page)).toHaveCount(1);
    await expect(panelHost(page)).toBeVisible();
    await expect(page).toHaveURL(`https://linear.app${GANTT}`);
    expect(await notFound(page)).toBe(0);
  });

  test('shows the usual message for a project that is unavailable or in another workspace', async ({ page }) => {
    await page.goto('https://linear.app/acme/project/ghost-ffffffffffff/gantt');
    await expect.poll(() => panelFrames(page).length).toBe(1);
    await expect(panelFrames(page)[0].locator('#gate-title')).toHaveText('Project unavailable');
    await expect(panelHost(page)).toBeVisible();

    await page.goto('https://linear.app/beta/project/launch-0a0b0c0d0e0f/gantt');
    await expect.poll(() => panelFrames(page).length).toBe(1);
    await expect(panelFrames(page)[0].locator('#gate-title')).toHaveText('Different workspace');
    await expect(page).toHaveURL('https://linear.app/beta/project/launch-0a0b0c0d0e0f/gantt');
    expect(await notFound(page)).toBe(0);
  });
});
