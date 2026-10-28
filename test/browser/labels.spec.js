import { MOBILE, expect, openGantt, row, shift, test, today } from './harness.js';

const chips = (frame, identifier) => row(frame, identifier).locator('.chip');
const dotColors = locator => locator.evaluateAll(nodes => nodes.map(node => getComputedStyle(node, '::before').backgroundColor));

test.beforeEach(async ({ signIn }) => signIn());

test("shows each issue's labels after its title, in the label's colour", async ({ page }) => {
  await page.goto(`https://linear.app${MOBILE}`);
  const frame = await openGantt(page);
  await expect(chips(frame, 'MOB-4')).toHaveText(['Bug', 'iOS']);
  await expect(chips(frame, 'MOB-4').nth(0)).toHaveAttribute('title', 'Bug');
  expect(await dotColors(chips(frame, 'MOB-4'))).toEqual(['rgb(235, 87, 87)', 'rgb(78, 167, 252)']);
  await expect(chips(frame, 'MOB-2')).toHaveText(['Design']);
  await expect(row(frame, 'MOB-4').locator('.line').first().locator('> *').last()).toHaveClass('chips');

  await expect(chips(frame, 'MOB-3')).toHaveCount(0);
  await expect(row(frame, 'MOB-3').locator('.chips')).toHaveCount(0);
  const heights = await frame.locator('.row.issue').evaluateAll(rows => new Set(rows.map(row => row.getBoundingClientRect().height)).size);
  expect(heights).toBe(1);
});

test('shows the first two labels and a +N chip listing the rest', async ({ page }) => {
  await page.goto(`https://linear.app${MOBILE}`);
  const frame = await openGantt(page);
  await expect(chips(frame, 'MOB-1')).toHaveText(['Feature', 'Sync', '+2']);
  await expect(chips(frame, 'MOB-1').last()).toHaveAttribute('title', 'iOS, Android');
  expect(await dotColors(chips(frame, 'MOB-1').last())).toEqual(['rgba(0, 0, 0, 0)']);
});

test('uses the muted colour for a label colour that is not a hex colour', async ({ page, linear }) => {
  linear.issue('MOB-2').labels.nodes[0].color = 'red; background: url(https://example.com/x)';
  await page.goto(`https://linear.app${MOBILE}`);
  const frame = await openGantt(page);
  await expect(chips(frame, 'MOB-2')).toHaveText(['Design']);
  expect(await dotColors(chips(frame, 'MOB-2'))).toEqual(['rgb(139, 142, 155)']);
});

test('truncates the title before the labels and keeps them inside the label column', async ({ page, linear }) => {
  linear.issue('MOB-4').title = 'Ship the public beta to TestFlight and the Play Store internal track for everyone';
  linear.issue('MOB-4').labels.nodes.push({ id: 'label-long', name: 'Customer escalation from the enterprise plan', color: '#26b5ce' });
  await page.goto(`https://linear.app${MOBILE}`);
  const frame = await openGantt(page);
  await expect(chips(frame, 'MOB-4')).toHaveText(['Bug', 'iOS', '+1']);
  const layout = await row(frame, 'MOB-4').evaluate(row => {
    const title = row.querySelector('.title');
    const label = row.querySelector('.label').getBoundingClientRect();
    return {
      truncated: title.scrollWidth > title.clientWidth,
      chipsWhole: [...row.querySelectorAll('.chip')].every(chip => chip.scrollWidth <= chip.clientWidth),
      inside: row.querySelector('.chips').getBoundingClientRect().right <= label.right,
      height: row.getBoundingClientRect().height
    };
  });
  expect(layout).toEqual({ truncated: true, chipsWhole: true, inside: true, height: (await row(frame, 'MOB-3').boundingBox()).height });
});

test('keeps the labels after saving a due date', async ({ page, linear }) => {
  await page.goto(`https://linear.app${MOBILE}`);
  const frame = await openGantt(page);
  const target = shift(today(), 20);
  await row(frame, 'MOB-1').locator('.due-input').fill(target);
  await row(frame, 'MOB-1').locator('.due-input').press('Enter');
  await expect(row(frame, 'MOB-1').locator('.save-state')).toHaveText('Saved');
  expect(linear.issue('MOB-1').dueDate).toBe(target);
  await expect(chips(frame, 'MOB-1')).toHaveText(['Feature', 'Sync', '+2']);
});
