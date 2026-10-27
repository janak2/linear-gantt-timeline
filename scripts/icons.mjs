// Renders icons/icon.svg to the PNG sizes the manifest and Chrome Web Store need.
// The 128px store icon keeps the 16px transparent padding; smaller sizes crop it.
import { readFile } from 'node:fs/promises';
import { chromium } from '@playwright/test';

const svg = await readFile('icons/icon.svg', 'utf8');
const browser = await chromium.launch();
const page = await browser.newPage();
for (const size of [16, 32, 48, 128]) {
  const art = size === 128 ? svg : svg.replace('viewBox="0 0 128 128"', 'viewBox="16 16 96 96"');
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(`<style>html,body{margin:0;background:transparent}svg{display:block;width:${size}px;height:${size}px}</style>${art}`);
  await page.screenshot({ path: `icons/icon-${size}.png`, omitBackground: true });
}
await browser.close();
console.log('Rendered icons/icon-{16,32,48,128}.png');
