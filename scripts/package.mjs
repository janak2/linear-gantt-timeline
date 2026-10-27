// Builds the Chrome Web Store upload: extension files only, manifest.json at the ZIP root.
import { execFileSync } from 'node:child_process';
import { rm } from 'node:fs/promises';
import path from 'node:path';
import { copyExtension, readClientId } from './extension-files.mjs';

if (!await readClientId()) throw new Error('Set LINEAR_CLIENT_ID in src/config.js before packaging a release.');
const stage = 'dist/extension';
// The Web Store assigns the production key, so the development key is left out.
const manifest = await copyExtension(stage, { stripKey: true });
const zip = path.resolve(`dist/gantt-view-for-linear-${manifest.version}.zip`);
await rm(zip, { force: true });
execFileSync('zip', ['-r', '-X', '-q', zip, '.'], { cwd: stage });
console.log(`Wrote ${path.relative(process.cwd(), zip)}`);
