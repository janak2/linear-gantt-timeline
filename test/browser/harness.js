import { test as base, expect, chromium } from '@playwright/test';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { copyExtension } from '../../scripts/extension-files.mjs';
import { CLIENT_ID, FakeLinear, PAGE } from './fake-linear.js';

export { expect };
export { CLIENT_ID, FakeLinear, MOBILE, WEBSITE, shift, today } from './fake-linear.js';

export const test = base.extend({
  extensionDir: [async ({}, use, workerInfo) => {
    const directory = path.join(tmpdir(), `linear-gantt-test-${process.pid}-${workerInfo.workerIndex}`);
    await copyExtension(directory, { clientId: CLIENT_ID });
    await use(directory);
  }, { scope: 'worker' }],

  context: async ({ extensionDir, timezoneId }, use) => {
    const context = await chromium.launchPersistentContext('', {
      channel: 'chromium',
      headless: !process.env.HEADED,
      timezoneId,
      viewport: { width: 1400, height: 900 },
      args: [`--disable-extensions-except=${extensionDir}`, `--load-extension=${extensionDir}`]
    });
    await use(context);
    await context.close();
  },

  linear: async ({ context }, use) => {
    const fake = new FakeLinear();
    await context.route('https://api.linear.app/**', route => fake.route(route));
    await context.route('https://linear.app/**', route => route.fulfill({ contentType: 'text/html', body: PAGE }));
    await use(fake);
  },

  worker: async ({ context }, use) => {
    const [existing] = context.serviceWorkers();
    await use(existing ?? await context.waitForEvent('serviceworker'));
  },

  signIn: async ({ worker, linear }, use) => {
    await use(async ({ expiresIn = 3_600_000 } = {}) => {
      await worker.evaluate(async ({ account, expiresIn }) => {
        await chrome.storage.session.set({ accessToken: 'access-1', expiresAt: Date.now() + expiresIn });
        await chrome.storage.local.set({ refreshToken: 'refresh-1', account });
      }, { account: linear.account, expiresIn });
    });
  }
});

export const ganttTab = page => page.locator('[data-linear-gantt="tab"]');
export const panelHost = page => page.locator('[data-linear-gantt="panel"]');
export const panelFrames = page => page.frames().filter(frame => frame.url().includes('/panel.html'));

export async function openGantt(page) {
  await ganttTab(page).click();
  await expect.poll(() => panelFrames(page).length).toBe(1);
  return panelFrames(page)[0];
}

export const row = (frame, identifier) => frame.locator('.row.issue').filter({ has: frame.locator('.identifier', { hasText: new RegExp(`^${identifier}$`) }) });

export async function drag(page, locator, dx) {
  const box = await locator.boundingBox();
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + dx / 2, y, { steps: 4 });
  await page.mouse.move(x + dx, y, { steps: 4 });
  await page.mouse.up();
}
