import { access, readFile, readdir } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';

const manifest = JSON.parse(await readFile('manifest.json', 'utf8'));
if (manifest.manifest_version !== 3) throw new Error('Manifest V3 required');
const resources = [
  manifest.background.service_worker,
  manifest.options_page,
  ...Object.values(manifest.icons),
  ...Object.values(manifest.action.default_icon),
  ...manifest.content_scripts.flatMap(script => script.js),
  ...manifest.web_accessible_resources.flatMap(entry => entry.resources)
];
for (const file of resources) await access(file);
const scripts = (await readdir('src', { recursive: true })).filter(file => file.endsWith('.js')).map(file => `src/${file}`);
for (const file of scripts) execFileSync(process.execPath, ['--check', file]);
console.log(`Manifest resources and ${scripts.length} scripts verified.`);
