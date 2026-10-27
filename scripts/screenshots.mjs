// Captures Chrome Web Store images using the test page and sample data.
import { chromium } from '@playwright/test';
import { mkdir, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { copyExtension } from './extension-files.mjs';
import { CLIENT_ID, FakeLinear, MOBILE, PAGE, shift, today } from '../test/browser/fake-linear.js';

const people = [{ id: 'u1', name: 'Maya Chen' }, { id: 'u2', name: 'Sam Ortiz' }, { id: 'u3', name: 'Priya Nair' }, { id: 'u4', name: 'Leo Brandt' }];
const states = {
  todo: { id: 'todo', name: 'Todo', type: 'unstarted', color: '#9ea0aa' },
  progress: { id: 'progress', name: 'In Progress', type: 'started', color: '#f2c94c' },
  review: { id: 'review', name: 'In Review', type: 'started', color: '#4cb782' },
  done: { id: 'done', name: 'Done', type: 'completed', color: '#5e6ad2' }
};
const t = today();
const sample = [
  ['Offline sync for drafts', -12, 2, 'review', 0],
  ['Redesign onboarding flow', -9, 6, 'progress', 1],
  ['Push notification settings', -6, 9, 'progress', 2],
  ['Crash on large attachments', -14, -4, 'done', 3],
  ['Dark mode polish', -3, 12, 'progress', 0],
  ['Accessibility audit', null, 15, 'todo', 1],
  ['Release notes for 2.0', null, 19, 'todo', 2],
  ['App Store screenshots', null, 22, 'todo', 3],
  ['Beta feedback triage', -1, 26, 'progress', 1],
  ['Analytics events review', null, null, 'todo', 0],
  ['Localization: Japanese', null, null, 'todo', 2]
];

const linear = new FakeLinear();
linear.issues = sample.map(([title, start, due, state, person], n) => ({
  id: `sample-${n}`,
  identifier: `MOB-${140 + n}`,
  title,
  url: `https://linear.app/acme/issue/MOB-${140 + n}`,
  dueDate: due === null ? null : shift(t, due),
  startedAt: start === null ? null : `${shift(t, start)}T10:00:00.000Z`,
  completedAt: state === 'done' ? `${shift(t, due - 1)}T16:00:00.000Z` : null,
  canceledAt: null,
  state: states[state],
  assignee: people[person],
  project: { id: 'project-mobile' }
}));

const extension = path.join(tmpdir(), 'linear-gantt-screenshots');
await copyExtension(extension, { clientId: CLIENT_ID });
await mkdir('store', { recursive: true });
const context = await chromium.launchPersistentContext('', {
  channel: 'chromium',
  headless: true,
  viewport: { width: 1280, height: 800 },
  args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`]
});
await context.route('https://api.linear.app/**', route => linear.route(route));
await context.route('https://linear.app/**', route => route.fulfill({ contentType: 'text/html', body: PAGE }));
const worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker');
await worker.evaluate(async account => {
  await chrome.storage.session.set({ accessToken: 'access-1', expiresAt: Date.now() + 3_600_000 });
  await chrome.storage.local.set({ refreshToken: 'refresh-1', account });
}, linear.account);

const page = await context.newPage();
await page.goto(`https://linear.app${MOBILE}`);
await page.locator('[data-linear-gantt="tab"]').click();
const frame = await (async () => {
  for (;;) {
    const found = page.frames().find(item => item.url().includes('/panel.html'));
    if (found) return found;
    await page.waitForTimeout(50);
  }
})();
await frame.locator('.row.issue').first().waitFor();
await page.screenshot({ path: 'store/screenshot-week-dark.png' });

await page.evaluate(() => window.setTheme('light'));
await frame.locator('html[data-theme="light"]').waitFor();
await frame.locator('[data-scale="day"]').click();
await page.mouse.move(0, 0);
await page.screenshot({ path: 'store/screenshot-day-light.png' });
await context.close();

const browser = await chromium.launch();
const tile = await browser.newPage({ viewport: { width: 440, height: 280 } });
const icon = await readFile('icons/icon.svg', 'utf8');
await tile.setContent(`<style>
  body { margin: 0; width: 440px; height: 280px; background: linear-gradient(135deg, #5e6ad2, #3b45a3); display: grid; place-items: center; overflow: hidden; }
  .rows { position: absolute; inset: 0; }
  .rows i { position: absolute; height: 18px; border-radius: 9px; background: #ffffff2e; }
  svg { width: 150px; height: 150px; position: relative; }
</style>
<div class="rows">
  <i style="left:24px;top:36px;width:150px"></i><i style="left:250px;top:36px;width:120px"></i>
  <i style="left:70px;top:226px;width:190px"></i><i style="left:300px;top:226px;width:90px"></i>
</div>${icon.replace('viewBox="0 0 128 128"', 'viewBox="16 16 96 96"')}`);
await tile.screenshot({ path: 'store/promo-small.png' });
await browser.close();
console.log('Wrote store/screenshot-week-dark.png, store/screenshot-day-light.png, store/promo-small.png');
